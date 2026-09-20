import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:http'

// Optional real-browser regression, using Node's test runner. Point
// RUNLY_BROWSER_TEST_MODULE at an installed playwright/index.mjs and install Chrome.
const browserModule = process.env.RUNLY_BROWSER_TEST_MODULE
test('company forms survive access polling, token rotation and background updates', { skip: !browserModule }, async () => {
  const { chromium } = await import(pathToFileURL(browserModule).href)
  const apiRequire = createRequire(new URL('../../../../api/package.json', import.meta.url))
  const { build } = apiRequire('esbuild')
  const directory = await mkdtemp(join(tmpdir(), 'runly-company-form-'))
  let server, browser
  try {
    const auth = `import React from 'react';
      export const Context = React.createContext(null);
      export const useAuth = () => React.useContext(Context);`
    const sdk = `export let company = 'company-a';
      export const setActiveCompanyId = (id) => { company = id };
      export const runly = {
        memberships: { me: async () => {
          window.membershipRequests++;
          await new Promise(r => setTimeout(r, 20));
          if(window.failMemberships) throw Object.assign(new Error('network'),{status:503});
          return structuredClone(window.memberships);
        } },
        company: {
          getProfile: async () => { window.profileRequests++; return {data:{ ...window.companyProfile, id:company }} },
          updateProfile: async (data) => { window.companyProfile=data; return {data} },
        },
      };`
    const ui = `import React from 'react';
      export const Card=({children})=><div>{children}</div>;
      export const Button=({children,...props})=><button {...props}>{children}</button>;
      export const PageHeader=()=>null, ErrorState=()=>null, Skeleton=()=>null;
      export const TextField=({label,value,onChange,disabled})=><label>{label}<input aria-label={label} value={value} onChange={onChange} disabled={disabled}/></label>;
      export const SelectField=({label,value,onValueChange,options,disabled})=><label>{label}<select aria-label={label} value={value} onChange={e=>onValueChange(e.target.value)} disabled={disabled}><option value=""/>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
      export const ComboboxField=({onChange,onValueChange,...props})=><SelectField {...props} onValueChange={onValueChange??onChange}/>;`
    const mocks = {
      auth,
      sdk,
      ui,
      loader: `export const AppLoader=()=>null`,
      floats: `export const useChatFloatStore={setState(){}}`,
      toast: `export const toast={success(){},error(){}}`,
    }
    await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx', contents: `
          import React, {useEffect,useState} from 'react';
          import {createRoot} from 'react-dom/client';
          import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
          import {Context} from '../auth/AuthProvider';
          import {ActiveCompanyProvider,ActiveCompanyGate,useActiveCompany} from './ActiveCompanyProvider.jsx';
          import CompanyProfile from '../modules/runly.company/screens/CompanyProfile.jsx';
          window.membershipRequests=0; window.profileRequests=0; window.mounts=0; window.profileRefreshes=0;
          window.memberships={authorizationRevision:'global-1',data:[
            {companyId:'company-a',authorizationRevision:'access-a',company:{id:'company-a',name:'A'}},
            {companyId:'company-b',authorizationRevision:'access-b',company:{id:'company-b',name:'B'}}]};
          window.companyProfile={name:'Server name',companyType:'sa_de_cv',companySize:'micro'};
          const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:60000,refetchOnWindowFocus:false}}});
          window.client=client;
          function Form(){useEffect(()=>{window.mounts++},[]);const scope=useActiveCompany();window.switchCompany=scope.setActiveCompany;return <CompanyProfile/>}
          function App(){const [token,setToken]=useState('token-1');window.rotateToken=()=>setToken('token-2');
            return <Context.Provider value={{session:{access_token:token,user:{id:'user-a'}},userProfile:{isAdmin:true},refreshProfile:()=>{window.profileRefreshes++}}}>
              <ActiveCompanyProvider><ActiveCompanyGate><Form/></ActiveCompanyGate></ActiveCompanyProvider>
            </Context.Provider>}
          createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
        `,
      },
      bundle: true, outfile: join(directory, 'bundle.js'), jsx: 'automatic', logLevel: 'silent',
      plugins: [{ name: 'test-boundaries', setup(builder) {
        builder.onResolve({ filter: /AuthProvider$/ }, () => ({ path: 'auth', namespace: 'mock' }))
        builder.onResolve({ filter: /\/lib\/runly$/ }, () => ({ path: 'sdk', namespace: 'mock' }))
        builder.onResolve({ filter: /chatFloatStore\.js$/ }, () => ({ path: 'floats', namespace: 'mock' }))
        builder.onResolve({ filter: /AppLoader$/ }, () => ({ path: 'loader', namespace: 'mock' }))
        builder.onResolve({ filter: /^@runly\/ui$/ }, () => ({ path: 'ui', namespace: 'mock' }))
        builder.onResolve({ filter: /^sonner$/ }, () => ({ path: 'toast', namespace: 'mock' }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'jsx', resolveDir: fileURLToPath(new URL('../../../', import.meta.url)) }))
      } }],
    })
    server = createServer(async (request, response) => {
      response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html')
      response.end(request.url === '/bundle.js' ? await readFile(join(directory, 'bundle.js')) : '<div id="root"></div><script src="/bundle.js"></script>')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const page = await browser.newPage()
    page.setDefaultTimeout(10_000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    const name = page.getByLabel('Nombre comercial', { exact: true })
    await name.waitFor()
    await name.fill('Unsaved draft')
    await page.getByLabel('Tipo de empresa', { exact: true }).selectOption('srl')
    // Exercise actual background polls, including an unrelated global revision.
    for (let revision = 2; revision <= 5; revision++) {
      await page.evaluate(async revision => {
        window.memberships.authorizationRevision = `global-${revision}`
        window.memberships.data[0].company.logoUrl = `signed-${revision}`
        await window.client.refetchQueries({queryKey:['memberships-me']})
      }, revision)
    }
    await page.evaluate(() => window.rotateToken())
    await page.evaluate(async () => {
      window.companyProfile.name='Server changed during editing'
      await window.client.invalidateQueries({queryKey:['company-profile']})
      window.failMemberships=true
      await window.client.refetchQueries({queryKey:['memberships-me']})
      window.failMemberships=false
      await window.client.refetchQueries({queryKey:['memberships-me']})
    })
    assert.equal(await name.inputValue(), 'Unsaved draft')
    assert.equal(await page.getByLabel('Tipo de empresa', { exact: true }).inputValue(), 'srl')
    assert.equal(await page.evaluate(() => window.mounts), 1)
    assert.equal(await page.evaluate(() => window.profileRequests), 2)
    assert.equal(await page.evaluate(() => window.profileRefreshes), 1)
    // A genuine authorization change must still evict old resource data.
    await page.evaluate(async () => {
      window.client.setQueryData(['private-note'], {body:'previously authorized'})
      window.memberships.data[0].authorizationRevision='access-a-revoked'
      await window.client.refetchQueries({queryKey:['memberships-me']})
    })
    await page.waitForFunction(() => window.profileRefreshes === 2)
    assert.equal(await page.evaluate(() => window.client.getQueryData(['private-note'])), undefined)
    await page.evaluate(() => window.switchCompany('company-b'))
    await page.waitForFunction(() => window.mounts === 2)
    await page.waitForFunction(() => document.querySelector('input[aria-label="Nombre comercial"]')?.value === 'Server changed during editing')
    await page.evaluate(async () => {
      window.memberships.data = window.memberships.data.filter(m => m.companyId !== 'company-b')
      await window.client.refetchQueries({queryKey:['memberships-me']})
    })
    await page.waitForFunction(() => window.mounts === 3)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    if (server) await new Promise(resolve => server.close(resolve))
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Unexpected test artifact directory')
    await rm(directory, { recursive: true, force: true })
  }
})
