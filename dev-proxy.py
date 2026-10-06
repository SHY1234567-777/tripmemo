#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TripMemo 本地调试代理（Day 20 · 2026-10-06）

⚠️ 这是**开发时的临时脚手架，不是项目代码** —— 所以它放在临时目录，不进仓库。

它解决一个问题：
    免费版 CloudBase 不让把 `localhost` 加进跨域白名单，
    所以「本地页面 → 云函数」会被网关拦掉（CORS 错误）。

它的做法：
    在本地起一个服务，同时干两件事 ——
      ① 提供静态文件（相当于 python -m http.server）
      ② ⭐ 把 /api/xxx 的请求**替浏览器转发**到云函数

    ⭐ 因为页面和 /api 在**同一个端口**（localhost:8000），
       浏览器认为它们是**同源**的 → ⭐ **根本不会触发跨域检查**。

用法：
    python 这个文件.py
    然后浏览器打开 http://localhost:8000

⚠️ 页面代码里的 API 地址要这样写（见 js/store.js 的 API_BASE）：
    本地  → 用相对路径 '/api/places'   （走这个代理）
    公网  → 用云函数完整地址             （静态托管下没有 /api，必须直连）
"""

import http.server
import socketserver
import urllib.request
import urllib.error
import os
import sys

# ⚠️ 云函数地址（本地转发用）—— 要改就改这里
API_ORIGIN = 'https://tripmemo-d3gd23bd14a396d1d-148733444.ap-shanghai.app.tcloudbase.com'

# ⚠️ 要提供哪些目录的静态文件（默认：这个脚本所在目录）
ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    """静态文件 + /api 反向代理"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---- 让日志短一点，只显示关键信息 ----
    def log_message(self, fmt, *args):
        msg = fmt % args
        if '/api/' in msg or 'POST' in msg or 'GET' in msg:
            print('  [代理]', msg)

    def _is_api(self):
        return self.path.startswith('/api/')

    # ---------------- 转发 ----------------
    def _proxy(self, method):
        url = API_ORIGIN + self.path
        body = None
        headers = {}

        # POST 要把请求体一起转发过去
        if method == 'POST':
            length = int(self.headers.get('Content-Length') or 0)
            body = self.rfile.read(length) if length else b''
            headers['Content-Type'] = self.headers.get('Content-Type') or 'application/json'

        print('  → 转发 %s %s' % (method, url))
        req = urllib.request.Request(url, data=body, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
                status = resp.status
                ctype = resp.headers.get('Content-Type', 'application/json; charset=utf-8')
        except urllib.error.HTTPError as e:
            # ⚠️ 400 / 409 / 404 这些**不是错误**，是接口的正常应答 —— 要原样透传给页面
            data = e.read()
            status = e.code
            ctype = e.headers.get('Content-Type', 'application/json; charset=utf-8')
            print('  ← %d（这是接口的应答，原样返回给页面）' % status)
        except Exception as e:
            # 真的连不上（网络、域名错等）
            msg = ('{"ok":false,"error":{"code":"PROXY_ERROR","message":"本地代理连不上云函数：%s"}}'
                   % str(e).replace('"', "'"))
            data = msg.encode('utf-8')
            status = 502
            ctype = 'application/json; charset=utf-8'
            print('  ✗ 代理转发失败：', e)

        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---------------- 路由 ----------------
    def do_GET(self):
        if self._is_api():
            self._proxy('GET')
        else:
            super().do_GET()

    def do_POST(self):
        if self._is_api():
            self._proxy('POST')
        else:
            self.send_error(405, 'Only /api/* accepts POST')

    def do_OPTIONS(self):
        # 同源请求不会走到这儿；万一有，直接放行
        self.send_response(204)
        self.end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    os.chdir(ROOT)
    print('=' * 64)
    print('TripMemo 本地调试代理')
    print('  静态文件目录：', ROOT)
    print('  接口转发目标：', API_ORIGIN)
    print('  打开这个地址：', 'http://localhost:%d' % PORT)
    print('  停止：Ctrl + C')
    print('=' * 64)
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n已停止。')
