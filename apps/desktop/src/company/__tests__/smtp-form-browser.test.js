import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

const browserModule = process.env.RUNLY_BROWSER_TEST_MODULE;
test('SMTP screens send company headers, preserve drafts, and expose an accessible password toggle', { skip: !browserModule }, async () => {
  const { chromium } = await import(pathToFileURL(browserModule).href);
  const { build } = createRequire(new URL('../../../../api/package.json', import.meta.url))('esbuild');
  const directory = await mkdtemp(join(tmpdir(), 'runly-smtp-form-'));
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const desktop = join(root, 'apps/desktop');
  let server, browser;
  try {
    const mocks = {
      auth: `export const useAuth=()=>({session:{access_token:'test-token'}});`,
      company: `export const useActiveCompany=()=>({activeCompanyId:window.company});`,
      sdk: `import {createRunlyClient} from '${join(root, 'packages/sdk/src/index.js').replaceAll('\\', '/')}';
        export const runly=createRunlyClient({baseUrl:'/api',getActiveCompanyId:()=>window.company});`,
      toast: `export const Toaster=()=>null; export const toast={success(){},error(message){window.toastError=message}};`,
    };
    await build({
      stdin: { resolveDir: desktop, loader: 'jsx', contents: `
        import React,{useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {MemoryRouter} from 'react-router-dom';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import Current from './src/modules/runly.core/screens/SmtpSettingsScreen.jsx';
        import Legacy from './src/modules/platform-settings/screens/SmtpSettingsScreen.jsx';
        import WebPush from './src/modules/runly.core/screens/WebPushSettingsScreen.jsx';
        import {PasswordField} from '@runly/ui';
        window.company='company-a'; window.requests=[];
        window.configs={};
        window.fetch=async(url,options={})=>{
          const company=options.headers['X-Runly-Company-Id'];
          window.requests.push({url,...options});
          if(!company) return {ok:false,status:400,text:async()=>JSON.stringify({error:'company_required'})};
          if(options.method==='POST'){
            window.configs[company]={...window.configs[company],...JSON.parse(options.body||'{}')};
            return {ok:true,json:async()=>({ok:true})};
          }
          return {ok:true,json:async()=>({data:{host:company+'.example.test',port:587,user:'sender@example.test',
            from_name:'Sender',from_email:'sender@example.test',tls:true,configured:false,
            ...window.configs[company]}})};
        };
        const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
        window.client=client;
        function App(){const [screen,setScreen]=useState('current'),[company,setCompany]=useState(window.company);
          window.select=(next,scope)=>{window.company=scope;setCompany(scope);setScreen(next)};
          const Screen=screen==='current'?Current:screen==='legacy'?Legacy:WebPush;
          return <MemoryRouter><QueryClientProvider client={client}>
            <Screen key={screen+company}/><PasswordField label="Disabled secret" disabled value="test-only"/>
          </QueryClientProvider></MemoryRouter>;
        }
        createRoot(document.getElementById('root')).render(<App/>);
      ` },
      bundle: true, outfile: join(directory, 'bundle.js'), jsx: 'automatic', logLevel: 'silent',
      // Match Vite's shared React runtime across workspace packages.
      alias: { react: join(desktop, 'node_modules/react'), 'react-dom': join(desktop, 'node_modules/react-dom') },
      plugins: [{ name: 'test-boundaries', setup(builder) {
        builder.onResolve({ filter: /AuthProvider\.jsx$/ }, () => ({ path: 'auth', namespace: 'mock' }));
        builder.onResolve({ filter: /ActiveCompanyProvider\.jsx$/ }, () => ({ path: 'company', namespace: 'mock' }));
        builder.onResolve({ filter: /\/lib\/runly\.js$/ }, () => ({ path: 'sdk', namespace: 'mock' }));
        builder.onResolve({ filter: /^sonner$/ }, () => ({ path: 'toast', namespace: 'mock' }));
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: mocks[path], loader: 'jsx', resolveDir: desktop }));
      } }],
    });
    server = createServer(async (request, response) => {
      response.setHeader('Content-Type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
      response.end(request.url === '/bundle.js' ? await readFile(join(directory, 'bundle.js')) : '<div id="root"></div><script src="/bundle.js"></script>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    for (const screen of ['current', 'legacy']) {
      await page.evaluate(screen => window.select(screen, 'company-a'), screen);
      const password = page.getByLabel('Contrasena', { exact: true });
      await password.waitFor().catch(error => { throw new Error(`${error.message}\nBrowser errors: ${errors.join('; ')}`); });
      assert.equal(await password.getAttribute('type'), 'password');
      await password.fill('draft-test-only');
      await password.press('Tab');
      const show = page.getByRole('button', { name: 'Mostrar contraseña' }).first();
      assert.equal(await show.evaluate(button => document.activeElement === button), true);
      await page.keyboard.press('Enter');
      assert.equal(await password.getAttribute('type'), 'text');
      await page.getByRole('button', { name: 'Ocultar contraseña' }).click();
      assert.equal(await password.getAttribute('type'), 'password');
      assert.equal(await page.evaluate(() => window.requests.filter(r => r.method === 'POST').length), screen === 'current' ? 0 : 1);
      await page.evaluate(async () => {
        window.configs['company-a']={from_name:'Background change'};
        await window.client.refetchQueries({queryKey:['smtp-settings','company-a']});
      });
      assert.equal(await password.inputValue(), 'draft-test-only');
      await page.getByRole('button', { name: 'Guardar configuracion', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('input[autocomplete="new-password"]')?.value === '');
      const request = await page.evaluate(() => window.requests.filter(r => r.method === 'POST').at(-1));
      assert.equal(request.headers['X-Runly-Company-Id'], 'company-a');
      assert.equal(JSON.parse(request.body).pass, 'draft-test-only');
      await password.fill('unsaved-company-a');
      await page.evaluate(screen => window.select(screen, 'company-b'), screen);
      await page.waitForFunction(() => document.querySelector('input[placeholder="smtp.gmail.com"]')?.value === 'company-b.example.test');
      assert.equal(await password.inputValue(), '');
    }
    await page.evaluate(() => window.select('webpush', 'company-b'));
    const privateKey = page.getByLabel(/^Llave privada/);
    await privateKey.fill('test-key').catch(async error => { throw new Error(`${error.message}\nBrowser errors: ${errors.join('; ')}\n${await page.locator('body').innerText()}`); });
    await page.getByRole('button', { name: 'Mostrar contraseña' }).first().click();
    assert.equal(await privateKey.getAttribute('type'), 'text');
    assert.equal(await page.getByRole('button', { name: 'Mostrar contraseña' }).last().isDisabled(), true);
    assert.equal(await page.evaluate(() => window.toastError), undefined);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Unexpected test artifact directory');
    await rm(directory, { recursive: true, force: true });
  }
});
