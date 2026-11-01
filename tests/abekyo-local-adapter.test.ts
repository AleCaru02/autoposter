import assert from "node:assert/strict";
import {assertLocalAbekyoUrl,validateAbekyoProject} from "../api/_lib/abekyo-local-adapter.js";
assert.equal(assertLocalAbekyoUrl("http://127.0.0.1:3000"),"http://127.0.0.1:3000");
for(const url of ["https://localhost:3000","http://example.com","http://localhost.evil.com","http://localhost:3000/path","http://user:pass@localhost:3000"]) assert.throws(()=>assertLocalAbekyoUrl(url));
let requestUrl="",requestMethod="",requestBody="";
const mockFetch = (async (url: string | URL | Request, options?: RequestInit) => {
 requestUrl=String(url);requestMethod=options?.method??"";requestBody=String(options?.body??"");
 return {ok:true,json:async()=>({valid:true})} as Response;
}) as typeof fetch;
const project={clips:[]};
const result=await validateAbekyoProject({baseUrl:"http://127.0.0.1:3000",enabled:true},project,mockFetch);
assert.deepEqual(result,{valid:true});
assert.equal(requestUrl,"http://127.0.0.1:3000/api/project/validate");
assert.equal(requestMethod,"POST");
assert.equal(requestBody,JSON.stringify(project));
await assert.rejects(()=>validateAbekyoProject({baseUrl:"http://127.0.0.1:3000",enabled:false},project,mockFetch));
await assert.rejects(()=>validateAbekyoProject({baseUrl:"http://127.0.0.1:3000",enabled:true},null,mockFetch));
console.log("Abekyo local adapter tests passed");
