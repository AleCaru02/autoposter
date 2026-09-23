import assert from "node:assert/strict";
import { chromium } from "playwright";

const base="https://autoposter.02alessandrocaruso.workers.dev";
const marker=process.env.PUBLICATION7F_MARKER||""; const password=process.env.PUBLICATION7F_PASSWORD||"";
const email=`publication7f-${marker}-owner@example.invalid`;
async function login(page){await page.goto(`${base}/login`,{waitUntil:"domcontentloaded",timeout:30000});await page.locator('input[type="email"]').fill(email);await page.locator('input[type="password"]').fill(password);await page.locator('button[type="submit"]').click();await page.waitForURL((url)=>url.pathname!=="/login",{timeout:20000});}
function watch(page){const errors=[];page.on("pageerror",(error)=>errors.push(`pageerror:${error.message}`));page.on("console",(message)=>{if(message.type()==="error")errors.push(`console:${message.text()}`);});return errors;}
const browser=await chromium.launch({headless:true});
try{
  const desktop=await browser.newContext({viewport:{width:1440,height:900}});const page=await desktop.newPage();const desktopErrors=watch(page);await login(page);await page.goto(`${base}/app/calendario`,{waitUntil:"domcontentloaded"});await page.getByRole("heading",{name:"Calendario contenuti",exact:true}).waitFor({timeout:20000});await page.getByText("Pubblicato",{exact:false}).first().waitFor({timeout:15000});assert.ok(await page.getByText("Pubblicato",{exact:false}).count()>=3);const dl=await page.evaluate(()=>({w:document.documentElement.scrollWidth,v:innerWidth}));assert.ok(dl.w<=dl.v+2);assert.deepEqual(desktopErrors,[]);await desktop.close();
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const mp=await mobile.newPage();const mobileErrors=watch(mp);await login(mp);await mp.goto(`${base}/app/calendario`,{waitUntil:"domcontentloaded"});await mp.getByRole("heading",{name:"Calendario contenuti",exact:true}).waitFor({timeout:20000});await mp.getByText("Pubblicato",{exact:false}).first().waitFor({timeout:15000});const ml=await mp.evaluate(()=>({w:document.documentElement.scrollWidth,v:innerWidth}));assert.ok(ml.w<=ml.v+2);assert.deepEqual(mobileErrors,[]);await mobile.close();
  console.log("FASE7F_PUBLICATION_BROWSER: PASS",JSON.stringify({desktop:"PASS",mobile:"PASS",publishedLifecycle:"PASS"}));
}finally{await browser.close();}
