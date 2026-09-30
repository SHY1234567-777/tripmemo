const http = require('http');

/**
 * TripMemo API 服务
 * ⚠️⚠️ 这是 **HTTP 云函数**，不是普通云函数 —— 两者形态完全不同：
 *
 *   |            | 普通云函数                        | HTTP 云函数（本文件）        |
 *   |------------|-----------------------------------|------------------------------|
 *   | 代码       | exports.main = async (event, ctx) | http.createServer + listen   |
 *   | 入参       | 平台包装好的 event（集成请求结构）| 标准 req / res               |
 *   | 启动       | 平台自动                          | 靠 scf_bootstrap 启动        |
 *   | 路由       | 平台按路径转发                    | 自己在函数里判断 req.url     |
 *
 * ⭐ 为什么选 HTTP 云函数：一个文件就能写多条路由，
 *    Day 16–20 要加五六个真接口时不用建一堆函数。
 * ⚠️ 代价：HTTP 函数**不会自动安装依赖**（node_modules 要自己带），
 *    所以这里**只用 Node 原生模块**，零依赖。
 *
 * ⚠️ 部署方式：**这个文件的内容要复制到 CloudBase 控制台的 `index.js` 里**
 *    （或者用 CloudBase CLI 部署 —— 见同目录 README.md）
 */

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const path = url.pathname;

  /* ⭐ GET /api/health —— 健康检查
     职责只有一个：证明「云函数 + 公网访问」这条链路是通的。
     ⚠️ 不连数据库、不写业务逻辑。

     ⚠️ 三个路径都放行，因为不确定平台转发过来时 URL 长什么样：
        · 开了「路径透传」→ 收到的是原始的 /api/health
        · 没开 → 可能被剥成 /
       先都兼容，稳一点。 */
  const isHealth = (path === '/api/health' || path === '/health' || path === '/');

  if (isHealth && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, service: 'TripMemo' }));
    return;
  }

  /* ⚠️ 路径对但方法不对 → 明确拒绝（别让它变成"万能入口"） */
  if (isHealth) {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
    return;
  }

  /* 其余路径 → 404。
     ⭐ Day 16–20 的真接口（读/写地点、城市、标签）会加在这之前。 */
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
});

// ⚠️ 端口必须是 9000 —— CloudBase 的 HTTP 函数固定监听这个端口（创建时不可改）
server.listen(9000);
