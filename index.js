#!/usr/bin/env node
const fs = require('fs');
const yamlRefs = require('yaml-refs');
const jsm = require('jsonschema');
const jsf = require('json-schema-faker');
const yargs = require('yargs')
const Koa = require('koa');
const Router = require('koa-router');
const app = new Koa();
const router = new Router();
const bodyParser = require('koa-bodyparser');

function packJRPCResponse({id, error, result}) {
    var resp = {
        "id": id,
        "jsonrpc": "2.0",
    };
    if (error) resp.error = error;
    if (result) resp.result = result;
    return resp;
}

function rpcCall(apiSpec, ctx, method, params) {
    const apiItem = apiSpec.endpoints[method];
    if (!apiItem) {
        let msg = 'rpc method not found';
        ctx.jsonrpcCode = -32601;
        throw new Error(msg);
    }
    const vr = jsm.validate(params, apiItem.params.schema);
    if (vr.errors.length) {
        ctx.jsonrpcCode = -32602;
        throw new Error('Invalid params');
    }
    
    var rpcResult;

    if (apiItem.returns.schema) {
        let res = jsf(apiItem.returns.schema);
        rpcResult = res;
    }
    else if (apiItem.returns.sample) {
        rpcResult = apiItem.returns.sample;
    }
    else {
        throw Error('API item definition error');
    }
    
    ctx.body = packJRPCResponse({
        id: ctx.jsonrpcID,
        result: rpcResult
    });
}


app.use(bodyParser());
app.use(router.routes()).use(router.allowedMethods());

const argv = yargs
    .option('spec', {
        describe: 'the API spec file',
        demandOption: true
    })
    .default('port', 3000)
    .argv;

yamlRefs(argv.spec).then(res => {
    var apiSpec = res;
    if (apiSpec.style == 'json-rpc') {
        router.post('/api', function (ctx) {
            var payload = ctx.request.body;
            var rpcMethod = payload.method;
            ctx.jsonrpcCode = 0;
            ctx.jsonrpcID = payload.id;
            
            try {
                rpcCall(apiSpec, ctx, rpcMethod, payload.params);
            } catch(err) {
                ctx.status = 200;
                let code = ctx.jsonrpcCode || -32000;
                let message = code == -32000? 'Server error': err.message;
                console.error(err.message);
                ctx.body = packJRPCResponse({
                    id: ctx.jsonrpcID,
                    error: {
                        code: ctx.jsonrpcCode || -32000,
                        message: message,
                    }
                });
            }
        });
    }
    
    router.get('/', (ctx) => {
        var info = apiSpec.info;
        ctx.body = `<h1>${info.title} v${info.version}</h1>`;
    });

    router.get('/exports/insomnia', (ctx) => {
        const workspaceID = `wrk_${apiSpec.id}`;

        const out = {
            "_type": "export",
            "__export_format": 3,
            "__export_date": new Date().toISOString(),
            "__export_source": "apimocker",
            "resources": [
                {
                  "_id": workspaceID,
                  "name": apiSpec.info.title,
                  "description": apiSpec.info.description,
                  "_type": "workspace"
                },
                {
                    "_id": "env_default",
                    "isPrivate": false,
                    "name": "Base Env",
                    "_type": "environment",
                    "parentId": workspaceID,
                    "data": {
                        "entry": apiSpec.entry
                    }
                }
            ]
        };
        for (var key in apiSpec.endpoints) {
            const item = apiSpec.endpoints[key];
            out.resources.push({
                "_type": "request",
                "parentId": workspaceID,
                "_id": `req:${key}`,
                "name": key,
                "method": "POST",
                "url": "{{entry}}",
                "body": {
                    "mimeType": "application/json",
                    "text": JSON.stringify({
                        "jsonrpc": "2.0",
                        "id": +new Date(),
                        "method": item.method || key,
                        "params": jsf(item.params.schema),
                    }, null, 4)
                },
                "description": `\`\`\`json\n${JSON.stringify(item, null, 4)}\n\`\`\``
            });
        }
        ctx.body = out;
    });

    router.get('/expanded', (ctx) => {
        ctx.body = apiSpec;
    });
});

app.listen(argv.port, () => {
    console.log(`Listening on port ${argv.port}...`);
});
