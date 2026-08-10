import { chromium } from '/root/svu-run/node_modules/playwright/index.mjs';
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
// THE HARNESS MUST MEASURE THE BUILD NEXT TO IT, not a fixed path. These tools
// hard-coded /root/racer, so an agent working in a git worktree would have
// photographed master's car and graded its own work by someone else's frame.
const __ROOT = __d(__d(__f(import.meta.url)));
const PAGE = 'file://' + __j(__ROOT, 'docs', 'index.html');
const SHOTS = __j(__ROOT, 'shots');

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
 args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await b.newPage({viewport:{width:640,height:300}});
await p.goto(PAGE,{waitUntil:'load'});
await p.waitForTimeout(2000);
const r = await p.evaluate(async ()=>{
  const R=window.RACER, SEG=R.consts.SEG_LEN;
  let sc=null; R.scene.traverse(o=>{ if(o.isInstancedMesh && o.instanceColor) sc=o; });
  const f=()=>new Promise(res=>requestAnimationFrame(()=>res()));
  const up=document.getElementById('bUp'); for(let i=0;i<30;i++) up.click();
  await f(); await f();
  const count = sc.count;
  const rows = 1 + Math.floor(count/(220*1.6));
  const pose=async(dist)=>{ R.st.view=3; R.st.dist=dist; R.st.x=0; R.tune.maxSpeed=210;
    R.st.speed=170; R.tune.freeze=true; R.st.slope=0; await f(); R.st.dist=dist; await f(); };
  // Read the COLOUR written for the slot holding track segment S. Colour is
  // three floats per instance and is unambiguous; the matrix packing is not.
  const colAt=(k)=>{ const a=sc.instanceColor.array;
    return [a[k*3],a[k*3+1],a[k*3+2]].map(v=>+v.toFixed(4)).join(','); };
  const S = 2100, out=[];
  for (const ahead of [60,40,20,10]) {
    await pose((S-ahead)*SEG);
    out.push({ahead, k: ahead*rows, col: colAt(ahead*rows)});
  }
  return {count, rows, out};
});
console.log(`scenery count ${r.count}, ${r.rows} rows deep\n`);
console.log('  the building at track segment 2100, from four distances:');
for (const o of r.out) console.log(`    ${String(o.ahead).padStart(3)} segments ahead  slot ${String(o.k).padStart(5)}  colour ${o.col}`);
const same = r.out.every(o=>o.col===r.out[0].col);
console.log(`\n  ${same ? 'SAME building all the way in — it belongs to the place'
                        : 'DIFFERENT building each time — still glued to the car'}`);
await b.close();
