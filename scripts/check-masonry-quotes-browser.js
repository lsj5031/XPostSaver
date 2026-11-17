// Whole-upstream offline compatibility gate, not a live-X or React reproduction.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
for (const name of ['XPS_PLAYWRIGHT','XPS_CHROMIUM','XPS_MASONRY_UPSTREAM']) {
  if (!process.env[name]) throw new Error(`Set ${name} to an absolute local path.`);
}
const { chromium } = require(process.env.XPS_PLAYWRIGHT);
const output = `${process.env.XPS_EVIDENCE || '/tmp/xps-masonry-sidebar-evidence'}/v3-quotes/${process.env.XPS_QUOTE_PHASE || 'final'}`;
await mkdir(output,{recursive:true});
const upstream = await readFile(process.env.XPS_MASONRY_UPSTREAM,'utf8');
const source = buildSync({ entryPoints:[new URL('../src/main.js',import.meta.url).pathname],bundle:true,write:false,format:'iife',loader:{'.css':'text'} }).outputFiles[0].text;
const bundle = await readFile(new URL('../x-post-saver-enhanced.user.js',import.meta.url),'utf8');
const native = await readFile(new URL('../tests/fixtures/masonry-navigation.html',import.meta.url),'utf8');
const image = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="140"><rect width="420" height="140" fill="#447799"/><text x="10" y="70" fill="white">Offline quoted media</text></svg>').toString('base64')}`;
const bar = '<div role="group"><button data-testid="reply">Reply</button><button data-testid="like">Like</button></div>';
function quote(id, tag='div', media='') {
  return `<${tag} ${tag==='div'?'role="link" tabindex="0"':'role="article" data-testid="tweet"'} class="quote" id="quote-${id}"><div data-testid="User-Name">Quoted fixture author</div><a class="quote-link" href="/quoted/status/${id}"><time>Quoted date</time></a><div data-testid="tweetText">Quoted fixture content ${id}</div>${media}${tag==='article'?bar:''}</${tag}>`;
}
function post(id, content='', linked=false) {
  return `<div data-testid="cellInnerDiv" id="cell-${id}" ${linked?'data-linked-card="true"':''}><article role="article" data-testid="tweet" id="post-${id}"><div data-testid="User-Name">Outer fixture author</div><a class="own-link" href="/outer/status/${id}"><time>Outer date ${id}</time></a><div data-testid="tweetText">Outer fixture content ${id}</div>${content}${bar}</article></div>`;
}
const cells = post(101) +
  post(102,quote(902)) +
  post(103,quote(903,'article')) +
  post(104,quote(904,'div',`<img src="${image}" alt="Quoted image fixture">`)) +
  post(105,'<div id="delayed-quote"></div>') +
  post(106,quote(906,'div',`<video controls width="280" height="94" poster="${image}"></video>`)) +
  post(107,quote(907)) +
  post(108,'<p class="visual-connection">Visually linked to <a class="quote-link" href="/outer/status/908">the following independent card</a></p>',true) +
  post(908,'<p class="visual-connection">Existing linked card, intentionally separate.</p>',true) +
  post(110) +
  `<div data-testid="cellInnerDiv" id="cell-111"><div data-testid="tweet" id="post-111"><div data-testid="User-Name">Div-root outer author</div><a class="own-link" href="/outer/status/111"><time>Outer date 111</time></a><div data-testid="tweetText">Native div-root post fixture</div>${quote(911,'article').replace(bar,'')}</div></div>`;
const html = native.replace('<head>','<head><script nonce="offline-fixture"></script>')
  .replace('</style>',`
  article { min-height:0; height:auto; }
  .quote { margin-top:12px; padding:12px; border:2px solid #447799; border-radius:10px; }
  .quote img { display:block; width:100%; height:auto; }
  .visual-connection { border-left:3px solid #447799; padding-left:12px; }
  </style>`);
const browser = await chromium.launch({ executablePath:process.env.XPS_CHROMIUM,headless:true,args:['--disable-background-networking'] });
const results = { upstreamSHA256:createHash('sha256').update(upstream).digest('hex'), browser:browser.version(), correction:'Quote content is present as two visually linked cards. Preserve representation; no missing-content repair.', scenarios:[] };

async function settle(page) {
  await page.waitForTimeout(550);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function render(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
    };
    const quotes = [...document.querySelectorAll('.quote')].map((node) => {
      const card=node.closest('[data-testid="cellInnerDiv"]');
      const r=rect(node), c=rect(card);
      return {id:node.id,text:node.querySelector('[data-testid="tweetText"]').textContent,rect:r,
        clippedRight:Math.max(0,r.right-c.right),clippedBottom:Math.max(0,r.bottom-c.bottom),
        hidden:[node,...(function*(){for(let p=node.parentElement;p;p=p.parentElement)yield p;})()]
          .some((p) => {const s=getComputedStyle(p);return s.display==='none'||s.visibility==='hidden'||s.contentVisibility==='hidden';})};
    });
    return { quotes, feed:rect(document.querySelector('[data-testid="primaryColumn"]')),
      container:document.querySelector('.xopt-masonry-container')?.id,
      linked:[...document.querySelectorAll('[data-linked-card]')].map((node) => ({id:node.id,article:node.querySelector('article').id,rect:rect(node)})),
      rows:[...document.querySelector('.timeline').children].map((node) => ({id:node.id,rect:rect(node),row:node.style.gridRow,column:node.style.gridColumn})),
      targets:[...document.querySelectorAll('.xps-masonry-key')].map((badge) => {
        const r=badge.getBoundingClientRect();
        return {key:badge.textContent,url:badge.dataset.url,article:document.elementFromPoint(r.x+14,r.y+14)?.closest('article')?.id};
      }),
      actions:[...document.querySelectorAll('.xps-save-btn, .xps-fact-btn')].map((button) => ({article:button.closest('article').id,url:button.dataset.url||null})),
      quoteLinks:[...document.querySelectorAll('.quote-link')].map((link) => link.getAttribute('href')),
      quoteHTML:[...document.querySelectorAll('.quote')].map((node) => {
        const copy=node.cloneNode(true);copy.querySelectorAll('.xps-save-btn,.xps-fact-btn').forEach((b)=>b.remove());return copy.outerHTML;
      }),
      overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    };
  });
}
function assertRendering(value) {
  assert.ok(value.quotes.every((q) => !q.hidden && q.clippedBottom<=1 && q.clippedRight<=1), 'quote text/media stays visible and within its upstream card');
  for (let i=0;i<value.rows.length;i++) for(let j=i+1;j<value.rows.length;j++) {
    const a=value.rows[i].rect,b=value.rows[j].rect;
    assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1 || Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1,'upstream card boxes do not overlap');
  }
  assert.deepEqual(value.linked.map((node)=>[node.id,node.article]),[['cell-108','post-108'],['cell-908','post-908']],'two linked native cards remain two separate cards');
  assert.equal(value.overflow,false);
}

try {
  for(const [kind,code] of [['source',source],['bundle',bundle]]) {
    for(const order of ['upstream-first','saver-first']) {
      const context=await browser.newContext({viewport:{width:1440,height:1100},serviceWorkers:'block',reducedMotion:'reduce'});
      const page=await context.newPage();
      const errors=[], requests=[];
      page.on('pageerror',(error)=>errors.push(error.message));
      await context.route('**/*',(route)=>{
        requests.push(route.request().url());
        return route.request().url()==='https://x.com/home'
          ?route.fulfill({contentType:'text/html',body:html}):route.abort();
      });
      await page.goto('https://x.com/home');
      await page.locator('.timeline').evaluate((timeline,cells)=>{
        timeline.innerHTML=cells;
        // Timestamp-bearing native inline quote before the outer timestamp;
        // and a loaded inline quote whose outer permalink is not available.
        const early=document.querySelector('#quote-902');
        document.querySelector('#post-102').prepend(early);
        document.querySelector('#post-107 .own-link').remove();
        timeline.id='quote-timeline';
        window.calls=[];window.quoteClicks=[];window.unexpectedWindows=[];
        window.GM_getValue=(_key,fallback)=>fallback;
        window.GM_setValue=()=>{throw new Error('Unexpected fixture storage write');};
        window.GM_openInTab=(url,options)=>{window.calls.push({url,options});return {};};
        window.open=(...args)=>{window.unexpectedWindows.push(args);return null;};
        // Observe link click reachability without navigation or fake React data.
        window.addEventListener('click',(event)=>{
          const link=event.target.closest?.('.quote-link');
          if(link){window.quoteClicks.push(link.getAttribute('href'));event.preventDefault();}
        },true);
        window.linkedNodes=[document.querySelector('#cell-108'),document.querySelector('#cell-908')];
      },cells);
      const prefix=`${kind}-${order}`;
      if(order==='saver-first') await page.addScriptTag({content:code});
      await page.addScriptTag({content:upstream});
      await page.waitForFunction(()=>document.__xopt_masonry_installed&&document.querySelector('.xopt-masonry-container'));
      await settle(page);
      const before=await render(page);
      assertRendering(before);
      await page.screenshot({path:`${output}/${prefix}-01-${order==='upstream-first'?'upstream-only':'both-saver-first'}.png`,fullPage:true});
      if(order==='upstream-first') await page.addScriptTag({content:code});
      await settle(page);
      const after=await render(page);
      const scenario={kind,order,before,after,errors,requests};
      results.scenarios.push(scenario);
      await page.screenshot({path:`${output}/${prefix}-02-integrated.png`,fullPage:true});
      assertRendering(after);
      assert.deepEqual(after.quoteLinks,before.quoteLinks);
      assert.deepEqual(after.quoteHTML,before.quoteHTML,'our integration does not rewrite native quote DOM');
      assert.ok(after.actions.every((action)=>action.article.startsWith('post-')),'Save/fact-check controls stay on outer action bars, not nested quote bars');
      for(const id of [101,103,104,105,106,108,908]) {
        assert.ok(after.actions.some((action)=>action.article===`post-${id}`&&action.url===`https://x.com/outer/status/${id}`),'ordinary/native nested-quote Save permalink stays on its outer post');
      }
      assert.equal(after.feed.width,1440);
      assert.equal(await page.evaluate(()=>window.linkedNodes.every((node)=>node.isConnected&&node.parentElement===document.querySelector('.timeline'))),true);
      for(const [id,url] of [[101,'https://x.com/outer/status/101'],[102,'https://x.com/outer/status/102'],[103,'https://x.com/outer/status/103'],[104,'https://x.com/outer/status/104'],[106,'https://x.com/outer/status/106'],[108,'https://x.com/outer/status/108'],[908,'https://x.com/outer/status/908']]) {
        await page.locator(`#post-${id}`).scrollIntoViewIfNeeded();
        await settle(page);
        assert.deepEqual((await render(page)).targets,[],'visible-post badges are paused');
        await page.locator(`#post-${id}`).evaluate((node)=>{node.tabIndex=0;node.focus({preventScroll:true});});
        const state=await page.evaluate(()=>({x:scrollX,y:scrollY,focus:document.activeElement.tagName,count:window.calls.length}));
        await page.keyboard.press('w');
        assert.deepEqual(await page.evaluate(()=>({x:scrollX,y:scrollY,focus:document.activeElement.tagName})),{x:state.x,y:state.y,focus:state.focus});
        assert.equal(await page.evaluate(()=>window.calls.length),state.count+1);
        assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{url,options:{active:false,insert:true,setParent:true}});
      }
      await page.locator('#post-107').scrollIntoViewIfNeeded();
      await settle(page);
      assert.equal((await render(page)).targets.some((entry)=>entry.article==='post-107'),false,'no outer permalink means no badge, not a quoted URL fallback');
      assert.equal((await render(page)).targets.some((entry)=>entry.article==='quote-903'),false,'nested quote is not an independent hint target');
      await page.locator('#quote-911').scrollIntoViewIfNeeded();
      await settle(page);
      scenario.divRootTargets=(await render(page)).targets;
      assert.equal(scenario.divRootTargets.some((entry)=>entry.article==='quote-911'),false,'nested quote inside a div-based outer post is not an independent hint target');
      await page.locator('#quote-902 .quote-link').click();
      assert.equal(await page.evaluate(()=>window.quoteClicks.at(-1)),'/quoted/status/902');
      const initialHeight=await page.locator('#post-105').evaluate((node)=>node.getBoundingClientRect().height);
      await page.locator('#delayed-quote').evaluate((node,markup)=>{node.innerHTML=markup;},quote(905,'article','<img id="delayed-image" alt="Delayed quoted image">'));
      await settle(page);
      const quoteHeight=await page.locator('#post-105').evaluate((node)=>node.getBoundingClientRect().height);
      await page.locator('#delayed-image').evaluate((node,src)=>{node.src=src;},image);
      await page.waitForFunction(()=>document.querySelector('#delayed-image').naturalWidth>0);
      await settle(page);
      const imageHeight=await page.locator('#post-105').evaluate((node)=>node.getBoundingClientRect().height);
      assert.ok(quoteHeight>initialHeight&&imageHeight>quoteHeight,'real upstream reacts to delayed quote/media height');
      scenario.delayed={initialHeight,quoteHeight,imageHeight,state:await render(page)};
      assertRendering(scenario.delayed.state);
      await page.screenshot({path:`${output}/${prefix}-03-delayed-media.png`,fullPage:true});
      await page.locator('.xps-nav-toggle').click();
      assert.equal(await page.locator('.xps-masonry-key').count(),0);
      assertRendering(await render(page));
      await page.keyboard.press('Escape');
      await settle(page);
      assertRendering(await render(page));
      scenario.calls=await page.evaluate(()=>window.calls);
      assert.deepEqual(await page.evaluate(()=>window.unexpectedWindows),[]);
      assert.deepEqual(requests,['https://x.com/home']);
      assert.deepEqual(errors,[]);
      await context.close();
    }
  }
  console.log(`Passed whole upstream + source/bundle, both load orders, quotes/media/linked-card preservation and own-post digit selection. Evidence: ${output}`);
} finally {
  await writeFile(`${output}/results.json`,JSON.stringify(results,null,2));
  await browser.close();
}
