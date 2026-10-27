import { chromium } from 'playwright';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
fs.mkdirSync('test-out', { recursive: true });
execSync('ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=3000x2000 -frames:v 1 -q:v 2 test-out/sample.jpg');
execSync('ffmpeg -loglevel error -y -f lavfi -i testsrc2=size=1920x1080:rate=30 -f lavfi -i sine=f=440 -t 3 -c:v libx264 -crf 10 -c:a aac -shortest test-out/sample.mp4');
const srv = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch(); const p = await b.newPage({ acceptDownloads: true });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://localhost:4173/');
let ok = true;
async function run(files, label) {
  await p.setInputFiles('#files', files); await p.evaluate(() => delete document.body.dataset.finished);
  await p.click('#go'); await p.waitForSelector('body[data-finished="1"]', { timeout: 300000 });
  const rows = await p.$$eval('li', (ls) => ls.map((l) => l.querySelector('.st').textContent));
  console.log(label, rows);
  const links = await p.$$('li a.dl');
  for (const a of links) { const [d] = await Promise.all([p.waitForEvent('download'), a.click()]); const o = 'test-out/' + label + '_' + d.suggestedFilename(); await d.saveAs(o);
    const probe = execSync(`ffprobe -v error -show_entries stream=codec_name,width,height -of csv=p=0 "${o}"`).toString().trim().replace(/\n/g, ' | ');
    console.log(' ', o, fs.statSync(o).size, 'bytes', probe); }
  if (links.length !== files.length) ok = false;
  const [z] = await Promise.all([p.waitForEvent('download'), p.click('#zip')]); await z.saveAs(`test-out/${label}.zip`);
  console.log('  zip', execSync(`unzip -l test-out/${label}.zip | tail -1`).toString().trim());
}
console.log('orig jpg', fs.statSync('test-out/sample.jpg').size, 'mp4', fs.statSync('test-out/sample.mp4').size);
await run(['test-out/sample.jpg', 'test-out/sample.mp4'], 'shrink');
for (const f of fs.readdirSync('test-out').filter((f) => f.startsWith('shrink_'))) {
  const src = f.includes('.mp4') ? 'sample.mp4' : 'sample.jpg'; if (fs.statSync('test-out/' + f).size >= fs.statSync('test-out/' + src).size) ok = false; }
await p.click('#tBack');
const back = fs.readdirSync('test-out').filter((f) => f.startsWith('shrink_')).map((f) => 'test-out/' + f);
await run(back, 'back');
await b.close(); srv.kill(); console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
