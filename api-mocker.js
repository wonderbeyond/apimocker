const fs = require('fs');
const yaml = require('js-yaml');
const jsm = require('jsonschema');
const jsf = require('json-schema-faker');
const yargs = require('yargs')
const Koa = require('koa');
const Router = require('koa-router');
const app = new Koa();
const router = new Router();
const bodyParser = require('koa-bodyparser');

app.use(bodyParser());
app.use(router.routes()).use(router.allowedMethods());


const argv = yargs
    .option('spec', {
        describe: 'the API spec file',
        demandOption: true
    })
    .default('port', 3000)
    .argv;

var apiSpec = yaml.safeLoad(fs.readFileSync(argv.spec, 'utf8'));

function packJRPCResponse({id, error, result}) {
    var resp = {
        "id": id,
        "jsonrpc": "2.0",
    }
    if (error) resp.error = error;
    if (result) resp.result = result;
    return resp;
}

if (apiSpec.style == 'json-rpc') {
    const rpcCall = function (ctx, method, params) {
        const apiItem = apiSpec.endpoints[method];
        if (!apiItem) {
            let msg = 'rpc method not found'
            ctx.jsonrpcCode = -32601;
            throw new Error(msg);
        }
        const vr = jsm.validate(params, apiItem.params.schema);
        if (vr.errors.length) {
            ctx.jsonrpcCode = -32602;
            throw new Error('Invalid params')
        }

        var rpcResult;

        if (apiItem.returns.sample) {
            rpcResult = apiItem.returns.sample;
        }
        else if (apiItem.returns.schema) {
            let res = jsf(apiItem.returns.schema)
            rpcResult = res;
        }

        ctx.body = packJRPCResponse({
            id: ctx.jsonrpcID,
            result: rpcResult
        });
    }

    router.post('/api', function (ctx, next) {
        var payload = ctx.request.body;
        var rpcMethod = payload.method;
        ctx.jsonrpcCode = 0;
        ctx.jsonrpcID = payload.id;

        try {
            rpcCall(ctx, rpcMethod, payload.params);
        } catch(err) {
            ctx.status = 200;
            let code = ctx.jsonrpcCode || -32000;
            let message = code == -32000? 'Server error': err.message;
            ctx.body = packJRPCResponse({
                id: ctx.jsonrpcID,
                error: {
                    code: ctx.jsonrpcCode || -32000,
                    message: message,
                }
            })
        }
    });
}

router.get('/', (ctx, next) => {
    var info = apiSpec.info;
    ctx.body = `<h1>${info.title} v${info.version}</h1>`;
});

router.get('/echo', (ctx, next) => {
    ctx.body = ctx.request.body;
});

app.listen(argv.port, () => {
    console.log(`Listening on port ${argv.port}...`);
});
