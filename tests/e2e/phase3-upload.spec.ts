import { expect, test } from '@playwright/test';
import { gzipSync } from 'node:zlib';
test.skip(process.env.MCSM_UPLOAD_E2E !== '1', 'Requires the isolated synthetic upload API');
function text(value: string) { const bytes=Buffer.from(value),length=Buffer.alloc(2);length.writeUInt16BE(bytes.length);return Buffer.concat([length,bytes]); }
function worldZip() {
  const data=gzipSync(Buffer.concat([Buffer.from([10]),text(''),Buffer.from([10]),text('Data'),Buffer.from([10]),text('Version'),Buffer.from([8]),text('Name'),text('26.3'),Buffer.from([0,0,0])]));
  let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc&1)?(crc>>>1)^0xedb88320:crc>>>1;}crc=(crc^0xffffffff)>>>0;
  const name=Buffer.from('level.dat'),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(46+name.length,12);end.writeUInt32LE(30+name.length+data.length,16);
  return Buffer.concat([local,name,data,central,name,end]);
}

for (const width of [360,768,1440]) {
  test(`actual streamed upload validates without switching a world at ${width}px`,async ({page})=>{
    await page.setViewportSize({width,height:900});await page.goto('/worlds?server=vanilla-upload');
    await expect(page.getByRole('heading',{name:'上传并校验世界 ZIP'})).toBeVisible();
    await expect(page.getByText('所有实例共享最多三次暂存上传。',{exact:false})).toBeVisible();
    await expect(page.getByText('自动清理默认关闭',{exact:false})).toBeVisible();
    await page.getByLabel('世界 ZIP（也可拖入一个文件）').setInputFiles({name:'测试.zip',mimeType:'application/zip',buffer:worldZip()});
    const response=page.waitForResponse((res)=>res.url().endsWith('/worlds/import-uploads')&&res.request().method()==='POST');
    await page.getByRole('button',{name:'上传并校验',exact:true}).click();
    const result=await response;expect(result.status()).toBe(201);
    expect((await result.json()).data).toMatchObject({state:'validated',executionAvailable:false,minecraftVersion:'26.3',fileCount:1});
    await expect(page.getByText('ZIP 已校验并暂存，尚未导入。')).toBeVisible();
    await expect(page.getByRole('button',{name:'上传并校验',exact:true})).toBeDisabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
    await page.screenshot({path:`test-results/screenshots/phase3-upload-${width}.png`,fullPage:true});
    await expect(page.getByRole('button',{name:'明确丢弃暂存',exact:true})).toBeVisible();
    page.once('dialog',(dialog)=>void dialog.accept());
    const discard=page.waitForResponse((res)=>res.url().endsWith('/discard')&&res.request().method()==='POST');
    await page.getByRole('button',{name:'明确丢弃暂存',exact:true}).click();
    expect((await discard).status()).toBe(200);
    await expect(page.getByText('当前实例没有暂存记录。')).toBeVisible();
    await expect(page.getByText('全局暂存配额：0 / 3；这里只显示当前实例记录。')).toBeVisible();
  });
}

for (const width of [360, 768, 1440]) {
  test(`explicit synthetic import preserves stop state and consumed upload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto('/worlds?server=vanilla-upload');
    await page.getByLabel('世界 ZIP（也可拖入一个文件）').setInputFiles({ name: 'import.zip', mimeType: 'application/zip', buffer: worldZip() });
    await page.getByRole('button', { name: '上传并校验', exact: true }).click();
    await expect(page.getByText('ZIP 已校验并暂存，尚未导入。')).toBeVisible();
    await page.getByRole('button', { name: '选择此暂存规划导入' }).click();
    await page.getByLabel('导入后的世界名称').fill(`import-${width}`);
    const response = page.waitForResponse((res) => res.url().endsWith('/worlds/import-plan'));
    await page.getByRole('button', { name: '校验导入计划', exact: true }).click();
    const plan = (await (await response).json()).data;
    const execute = page.getByRole('button', { name: '确认导入并保持停服' });
    await expect(execute).toBeDisabled();
    await page.getByLabel('输入当前世界名确认导入').fill(plan.currentWorldName);
    await expect(execute).toBeDisabled();
    await page.getByLabel('我确认保留旧世界和保护备份，并允许必要停服').check();
    const accepted = page.waitForResponse((res) => res.url().endsWith('/worlds/import') && res.request().method() === 'POST');
    await execute.click(); expect((await accepted).status()).toBe(202);
    await expect(page.getByText('世界已导入，旧世界及保护备份保留；服务器保持停止，请另行明确启动。')).toBeVisible();
    await expect(page.getByText('导入事务已占用，保留暂存且不可丢弃')).toHaveCount(width === 360 ? 1 : width === 768 ? 2 : 3);
    await expect(page.getByRole('button', { name: '选择此暂存规划导入' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `test-results/screenshots/phase3-import-${width}.png`, fullPage: true });
    await page.reload();
    await expect(page.getByText('导入事务已占用，保留暂存且不可丢弃')).toHaveCount(width === 360 ? 1 : width === 768 ? 2 : 3);
    for (const button of await page.getByRole('button', { name: '明确丢弃暂存', exact: true }).all()) await expect(button).toBeDisabled();
  });
}
