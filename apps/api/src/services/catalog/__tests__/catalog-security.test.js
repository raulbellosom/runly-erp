import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdtemp, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { generateKeyPairSync } from 'node:crypto'
import { compileModule, archiveModule, createStarterDefinition } from '@runly/module-compiler/server'
import { inspectModuleZip } from '@runly/module-compiler/inspection'
import { signEntry, sha256Of } from '../catalog-crypto.js'
import { validateCatalogIndex, verifyCatalogManifest } from '../catalog-schema.js'
import { readCatalogBytes, publicAddress, resolveCatalogAddress } from '../catalog-download.js'
import { createCatalogService, compareVersions } from '../catalog-service.js'

const keys = generateKeyPairSync('ed25519')
const publicKey = keys.publicKey.export({format:'der',type:'spki'}).toString('base64')
const privateKey = keys.privateKey.export({format:'pem',type:'pkcs8'})
const definition = createStarterDefinition({key:'custom.catalogtest',name:'Synthetic catalog'})
const compiled = compileModule(definition)
const zip = await archiveModule(compiled)
const manifest = inspectModuleZip(zip).manifest
const entry = {key:manifest.key,version:manifest.version,sha256:sha256Of(zip),size:zip.length,packageUrl:'packages/test.zip'}
entry.signature = signEntry(entry,privateKey)
const index = {schemaVersion:1,generatedAt:'2026-10-04T00:00:00.000Z',modules:[entry]}
test('strict v1 accepts traditional ZIP and rejects malformed/unknown/duplicate fields',()=>{
 assert.equal(validateCatalogIndex(index),index)
 for(const patch of [{key:[entry.key]},{key:entry.key+'\n'},{version:entry.version+'\n'},{sha256:entry.sha256+'\n'}])assert.throws(()=>validateCatalogIndex({...index,modules:[{...entry,...patch}]}))
 assert.equal(verifyCatalogManifest(entry,inspectModuleZip(zip)).name,manifest.name)
 for(const patch of [{schemaVersion:2},{unknown:true},{modules:[entry,entry]},{modules:[{...entry,version:'01.0.0'}]},{modules:[{...entry,key:'arbitrary'}]},{modules:[{...entry,sha256:'a'}]},{modules:[{...entry,signature:'fake'}]},{modules:[{...entry,size:0}]},{modules:[{...entry,packageUrl:'ftp://catalog.example/a'}]},{modules:[{...entry,official:true}]},{modules:[{...entry,consumes:{'runly.core':'fake'}}]}]) assert.throws(()=>validateCatalogIndex({...index,...patch}))
})
test('identity, version and security metadata must agree with inspected bytes',()=>{
 const report=inspectModuleZip(zip)
 for(const patch of [{key:'custom.other'},{version:'99.0.0'},{capabilities:['forged']},{consumes:{'runly.inventory':['items.read']}},{events:['inventory.item.created']},{connections:[{target:'project',kind:'related',label:'Forged'}]}]) assert.throws(()=>verifyCatalogManifest({...entry,...patch},report))
 assert.ok(compareVersions('1.0.0','1.0.0-rc.1')>0)
 assert.ok(compareVersions('1.0.0-rc.10','1.0.0-rc.2')>0)
})
const dns = async()=>[{address:'192.0.2.1',family:4}]
function requestFixture(responses,addresses=[]) {
 return (_url,options,done)=>{
  const request=new EventEmitter()
  request.end=()=>{
   options.lookup('catalog.example',{all:true},(_error,value)=>addresses.push(value))
   const fixture=responses.shift(),response=Readable.from(fixture.chunks??[])
   response.statusCode=fixture.status??200;response.headers=fixture.headers??{}
   queueMicrotask(()=>done(response))
  }
  return request
 }
}
test('count actual bytes with no Content-Length and destroy oversized response',async()=>{
 await assert.rejects(readCatalogBytes('https://catalog.example/index.json',{maxBytes:8,resolveHost:dns,requestImpl:requestFixture([{chunks:[Buffer.alloc(5),Buffer.alloc(5)]}])}),/TOO_LARGE/)
 await assert.rejects(readCatalogBytes('https://catalog.example/index.json',{maxBytes:8,resolveHost:dns,requestImpl:requestFixture([{headers:{'content-length':'100'},chunks:[]}])}),/TOO_LARGE/)
 const pinned=[]
 const result=await readCatalogBytes('https://catalog.example/index.json',{maxBytes:8,resolveHost:dns,requestImpl:requestFixture([{chunks:[Buffer.from('safe')]}],pinned)})
 assert.equal(result.buffer.toString(),'safe');assert.deepEqual(pinned,[[{address:'192.0.2.1',family:4}]])
})
test('reject private/local/metadata, mixed DNS, protocol redirects and downgrade',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','fe80::1']) assert.equal(publicAddress(address),false)
 for(const location of ['http://127.0.0.1/a','http://[::1]/a','http://169.254.169.254/a','file:///index.json','ftp://catalog.example/a']) await assert.rejects(readCatalogBytes('http://catalog.example/a',{resolveHost:dns,requestImpl:requestFixture([{status:302,headers:{location}}])}),/PRIVATE_ADDRESS|REDIRECT_REJECTED/)
 await assert.rejects(resolveCatalogAddress(new URL('http://localhost/a'),async()=>[{address:'127.0.0.1',family:4}]),/PRIVATE_ADDRESS/)
 await assert.rejects(resolveCatalogAddress(new URL('http://catalog.example/a'),async()=>[{address:'192.0.2.1',family:4},{address:'10.0.0.1',family:4}]),/PRIVATE_ADDRESS/)
 await assert.rejects(readCatalogBytes('https://catalog.example/a',{resolveHost:dns,requestImpl:requestFixture([{status:302,headers:{location:'http://catalog.example/a'}}])}),/REDIRECT_REJECTED/)
})
test('explicit local file catalogs retain bounded reads and reject path/symlink escape',async()=>{
 const root=await mkdtemp(join(tmpdir(),'runly-catalog-')),local=join(root,'local');await mkdir(local)
 const file=join(local,'index.json');await writeFile(file,'safe')
 assert.equal((await readCatalogBytes(pathToFileURL(file),{localRoot:local,maxBytes:4})).buffer.toString(),'safe')
 await assert.rejects(readCatalogBytes(pathToFileURL(file),{maxBytes:4}),/LOCAL_NOT_CONFIGURED/)
 await assert.rejects(readCatalogBytes(pathToFileURL(file),{localRoot:local,maxBytes:3}),/TOO_LARGE/)
 const outside=join(root,'outside.json');await writeFile(outside,'private')
 await assert.rejects(readCatalogBytes(pathToFileURL(outside),{localRoot:local}),/LOCAL_PATH_REJECTED/)
 // Directory junctions require no Windows symlink privilege.
 await symlink(root,join(local,'escape'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(readCatalogBytes(pathToFileURL(join(local,'escape','outside.json')),{localRoot:local}),/LOCAL_PATH_REJECTED/)
})

function fixture() {
 let cached=null,current=null,mode='online',installed=0,published=0
 const configs=new Map([['catalog.url','https://catalog.example/index.json'],['catalog.publicKeys',JSON.stringify([publicKey])]])
 const grant={deleteMany:async()=>{},findMany:async()=>[],create:async()=>{}}
 const prisma={instanceConfig:{findUnique:async({where})=>({value:configs.get(where.key)}),upsert:async()=>{}},moduleCatalogCache:{findUnique:async()=>cached,upsert:async({create})=>{cached={...create,fetchedAt:new Date()}},update:async()=>{}},runlyModule:{findMany:async()=>current?[current]:[],findUnique:async()=>current},moduleServiceGrant:grant,$transaction:async fn=>fn({moduleServiceGrant:grant})}
 const service=createCatalogService({prisma,officialKeys:[],readBytes:async(url,{headers})=>{
  if(mode==='offline') throw new Error('network offline')
  if(url.endsWith('index.json')) return mode==='etag'&&headers['If-None-Match']?{status:304}:{status:200,buffer:Buffer.from(JSON.stringify(index)),etag:'fixture'}
  return {status:200,buffer:zip}
 },packageWiring:{packageSvc:{publishZip:async({fileBuffer})=>{assert.deepEqual(fileBuffer,zip);published++;current={key:entry.key,version:entry.version,status:'PUBLISHED',manifest};return {outcome:'published'}}},lifecycleSvc:{installModule:async()=>{installed++;current.status='INSTALLED'}}}})
 return {service,setMode:value=>{mode=value},setCurrent:value=>{current=value},counts:()=>({installed,published})}
}
test('ETag/cache/offline retain verified evidence; managed key cannot claim official',async()=>{
 const f=fixture(),list=await f.service.list()
 assert.equal(list.modules[0].verified,true);assert.equal(list.modules[0].official,false)
 assert.deepEqual(list.modules[0].consumes,manifest.consumes??{})
 f.setMode('etag');assert.equal((await f.service.list()).offline,false)
 f.setMode('offline');const offline=await f.service.list();assert.equal(offline.offline,true);assert.equal(offline.modules[0].verified,true)
 await assert.rejects(f.service.install({key:entry.key}),/Sin conexión/)
})
test('install and update use exact verified ZIP; unexpected grants fail before publishing',async()=>{
 const f=fixture()
 await assert.rejects(f.service.install({key:entry.key,grants:['runly.inventory:items.read']}),/Grant/)
 assert.deepEqual(f.counts(),{installed:0,published:0})
 const result=await f.service.install({key:entry.key});assert.equal(result.official,false);assert.equal(result.installed,true)
 f.setCurrent({key:entry.key,version:'0.0.1',status:'INSTALLED',manifest})
 const update=await f.service.update({key:entry.key});assert.equal(update.version,entry.version);assert.equal(f.counts().published,2)
})
