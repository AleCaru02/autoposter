import assert from "node:assert/strict";
import { chromium } from "playwright";

const base="https://autoposter.02alessandrocaruso.workers.dev";
const marker=process.env.CALENDAR7E_MARKER||"";
const password=process.env.CALENDAR7E_PASSWORD||"";
const email=`calendar7e-${marker}-owner@example.invalid`;
assert.match(marker,/^[a-z0-9]{10,32}$/); assert.ok(password.length>=24);

async function login(page){await page.goto(`${base}/login`,{waitUntil:"domcontentloaded",timeout:30000}); await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill(password); await page.locator('button[type="submit"]').click(); await page.waitForURL((url)=>url.pathname!=="/login",{timeout:20000});}
function watch(page){const errors=[]; page.on("pageerror",(error)=>errors.push(`pageerror:${error.name}:${error.message}`)); page.on("console",(message)=>{if(message.type()==="error")errors.push(`console:${message.text()}`);}); return errors;}

const browser=await chromium.launch({headless:true});
try{
  const desktop=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await desktop.newPage(); const desktopErrors=watch(page);
  await login(page); await page.goto(`${base}/app/calendario`,{waitUntil:"domcontentloaded"});
  await page.getByRole("heading",{name:"Calendario contenuti",exact:true}).waitFor({timeout:20000});
  await page.locator("details.calendar-settings summary").click();
  const instagram=page.locator("article.schedule-card").filter({hasText:"Instagram"});
  await instagram.locator('input[type="number"]').fill("5");
  await Promise.all([page.waitForResponse((r)=>r.url().endsWith("/api/calendar")&&r.status()===200,{timeout:20000}),instagram.locator('input[type="number"]').blur()]);
  const desktopLayout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth}));
  assert.ok(desktopLayout.scrollWidth<=desktopLayout.viewportWidth+2,`desktop overflow ${JSON.stringify(desktopLayout)}`);
  assert.deepEqual(desktopErrors,[],`desktop browser errors ${JSON.stringify(desktopErrors)}`);
  await desktop.close();

  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const mobilePage=await mobile.newPage(); const mobileErrors=watch(mobilePage);
  await login(mobilePage); await mobilePage.goto(`${base}/app/calendario`,{waitUntil:"domcontentloaded"});
  await mobilePage.getByRole("heading",{name:"Calendario contenuti",exact:true}).waitFor({timeout:20000});
  await mobilePage.locator("details.calendar-manual summary").click();
  const approvedOptions=await mobilePage.locator("details.calendar-manual select option").count();
  assert.ok(approvedOptions>0,"approved calendar content missing on mobile");
  const mobileLayout=await mobilePage.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth}));
  assert.ok(mobileLayout.scrollWidth<=mobileLayout.viewportWidth+2,`mobile overflow ${JSON.stringify(mobileLayout)}`);
  assert.deepEqual(mobileErrors,[],`mobile browser errors ${JSON.stringify(mobileErrors)}`);
  await mobile.close();
  console.log("FASE7E_CALENDAR_BROWSER: PASS",JSON.stringify({desktop:"PASS",mobile:"PASS",serverSaveObserved:"PASS"}));
}finally{await browser.close();}
