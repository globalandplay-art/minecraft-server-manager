import { expect, test } from '@playwright/test';
import type { ServersResponse } from '@mcsm/contracts';
import { buildApp } from '../../apps/api/src/app.js';
import { discoverConfiguration } from '../../apps/api/src/services/configuration-discovery.js';

// In-process Fake HTTP + real browser only. No Java, registered user instance or real credentials.
for (const width of [360,768,1440]) test(`LC1.1 discovery conflict and protected save ${width}`, async ({page}) => {
  const mock = buildApp({mode:'mock'}); await mock.ready();
  try {
    const servers = (await mock.inject({method:'GET',url:'/api/v1/servers',headers:{host:'127.0.0.1:8080'}})).json<ServersResponse>();
    const server = servers.data.items[0]!; server.capabilities.properties = true;
    servers.meta.mode = 'local';
    const id = server.server.id;
    const csrf = 'a'.repeat(43), revision = () => (changed ? 'b' : 'a').repeat(64);
    const meta = () => ({mode:'local',generatedAt:new Date().toISOString(),requestId:'lc11-browser'});
    let changed = false, saved = false, mutations = 0;
    const rules = Object.fromEntries(['max-players','difficulty','gamemode','pvp','online-mode','view-distance','simulation-distance','motd'].map(key =>
      [key,{editable:key === 'pvp',restartRequired:true,reason:key === 'pvp' ? null : 'VERSION_RULE_UNAVAILABLE'}]));
    await page.routeWebSocket('**/ws/**',socket => socket.close());
    await page.route('**/api/**',async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (pathname === '/api/v1/auth/status') return route.fulfill({json:{data:{configured:true,authenticationRequired:true,auditReady:true}}});
      if (pathname === '/api/v1/auth/session') return route.fulfill({json:{data:{authenticated:true,csrfToken:csrf,recentReauthentication:true,expiresAt:new Date(Date.now()+1800000).toISOString()},meta:meta()}});
      if (pathname === '/api/v1/servers') {
        server.status = {...server.status,state:'stopped',ownership:'none',activeOperationId:null,recoveryRequired:false,observedAt:new Date().toISOString()};
        return route.fulfill({json:servers});
      }
      if (pathname === `/api/v1/servers/${id}/properties` && request.method() === 'GET') {
        const text = `pvp=${saved ? 'false' : 'true'}\n${changed ? 'new-performance-option=12' : 'old-extra=1'}\nenable-rcon=false\napi-key=PRIVATE_SENTINEL\n`;
        const fields = Object.fromEntries(Object.keys(rules).map(key => [key,key === 'pvp' ? !saved : null]));
        return route.fulfill({json:{data:{fields,fieldRules:rules,revision:revision(),discovery:{...discoverConfiguration(text,'vanilla','26.3',rules,fields),fileIdentity:'c'.repeat(64)}},meta:meta()}});
      }
      if (pathname === `/api/v1/servers/${id}/properties` && request.method() === 'PATCH') {
        expect(request.postDataJSON()).toEqual({changes:{pvp:'false'},confirmOfflineIdentity:false});
        expect(request.headers()['if-match']).toBe(`"${revision()}"`); expect(request.headers()['x-csrf-token']).toBe(csrf);
        mutations++; saved = true;
        return route.fulfill({status:202,json:{data:{operation:{id:'lc11-operation',serverId:id,kind:'properties-write',state:'queued',step:'queued',progress:null,createdAt:meta().generatedAt,updatedAt:meta().generatedAt,result:null,error:null},restartRequired:true,restartFields:['pvp']},meta:meta()}});
      }
      if (pathname === '/api/v1/operations/lc11-operation') return route.fulfill({json:{data:{id:'lc11-operation',serverId:id,kind:'properties-write',state:'succeeded',step:'completed',progress:null,createdAt:meta().generatedAt,updatedAt:meta().generatedAt,result:{resourceId:'fixture-guard',rollbackAvailable:false},error:null},meta:meta()}});
      if (request.method() !== 'GET') throw new Error(`Unexpected mutation ${pathname}`);
      const response = await mock.inject({method:'GET',url:pathname+new URL(request.url()).search,headers:{host:'127.0.0.1:8080'}});
      return route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});
    });
    await page.setViewportSize({width,height:900}); await page.goto(`/settings?server=${id}`);
    await expect(page.locator('code').filter({hasText:/^old-extra$/})).toBeVisible();
    await expect(page.getByText('PRIVATE_SENTINEL')).toHaveCount(0);
    await page.getByLabel('玩家对战',{exact:true}).selectOption('false');
    changed = true; await page.getByRole('button',{name:'刷新当前配置，保留草稿'}).click();
    await expect(page.getByRole('heading',{name:'磁盘配置发生变化'})).toBeVisible();
    expect(mutations).toBe(0); await expect(page.getByRole('button',{name:'备份并保存配置'})).toBeDisabled();
    await page.getByRole('button',{name:/确认比较/}).click();
    await expect(page.getByText('old-extra',{exact:true})).toHaveCount(0);
    await expect(page.getByText('new-performance-option',{exact:true})).toHaveCount(2); // label and original key
    await expect(page.getByLabel('玩家对战',{exact:true})).toHaveValue('false');
    await page.getByLabel(/确认以上变更/).check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button',{name:'备份并保存配置'}).click();
    await expect(page.getByText(/配置已保存。需要重启/)).toBeVisible(); expect(mutations).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await mock.close(); }
});
