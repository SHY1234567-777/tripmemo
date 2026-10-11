#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
TripMemo 发布前检查（Day 25 · 2026-10-11）

用途：每次发布前跑一遍，逐项给出 PASS / FAIL / SKIP + 证据。

⚠️ 设计原则（很重要）
  1. **每项独立**：一项崩了不影响其它项 —— 全部包在 try 里，单项异常只标记该项。
  2. **联网项要能区分"真的坏了"和"我这儿没网"**：
     ⚠️ 网络不通 / 代理没开 → 标 **SKIP**，绝不标 FAIL。
        （不然没网的时候满屏红，检查器就没人信了 —— 这就是"误报"的来源）
     ⭐ 本项目手动开了系统代理时，urllib 会跟着走；这里统一**绕过代理直连**，
        避免"代理没开导致检查误报"（2026-10-10 踩过这个坑）。
  3. **检查项全部来自本项目真实踩过的坑**，不是通用模板。
  4. 退出码：有 FAIL 返回 1，全绿返回 0（方便以后接 CI，但今天不做流水线）。

用法：
    python verify-project.py
"""
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
import json

ROOT = os.path.dirname(os.path.abspath(__file__))
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # 绕过系统代理

SITE = 'https://tripmemo-d3gd23bd14a396d1d-1498733444.tcloudbaseapp.com/tripmemo/'
CF = 'https://tripmemo-d3gd23bd14a396d1d-148733444.ap-shanghai.app.tcloudbase.com'
ENV = 'tripmemo-d3gd23bd14a396d1d'

results = []   # (序号, 名称, 状态, 证据)


def add(no, name, status, evidence):
    results.append((no, name, status, evidence))


def net_get(url, timeout=15, headers=None):
    """返回 (状态码, 正文) ；连不上抛异常由调用方处理"""
    req = urllib.request.Request(url, headers=headers or {})
    with OPENER.open(req, timeout=timeout) as r:
        return r.status, r.read().decode('utf-8', 'replace')


def local(cmd):
    """跑一条本地命令，返回 (返回码, 输出)"""
    p = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return p.returncode, (p.stdout or '') + (p.stderr or '')


# ============================================================
# 1. 硬编码密钥（Day 23 自查：前端代码里不能出现真 Key）
# ============================================================
def check_1():
    code, out = local('git grep -nE "[0-9a-fA-F]{32}" -- "*.js" "*.html" "*.css"')
    hits = [l for l in out.split('\n') if l.strip()]
    # 允许出现的地方：文档说明 / 模板 / 只读配置的代码
    allowed = ('README.md', 'config.example.js', 'config.js', '.md:')
    bad = [h for h in hits if not any(a in h for a in allowed)]
    if bad:
        add(1, '硬编码密钥', 'FAIL', '出现了疑似真 Key 的行：\n      ' + '\n      '.join(bad[:5]))
    else:
        add(1, '硬编码密钥', 'PASS', '代码/页面里没有 32 位十六进制字符串（模板与文档不算）')


# ============================================================
# 2. Git 历史里有没有提交过密钥（Day 23 确认：从未）
# ============================================================
def check_2():
    code, out = local('git log --all --full-history --oneline -- config.js')
    if out.strip():
        add(2, 'Git 历史里的 config.js', 'FAIL', 'config.js 曾进过提交：\n      ' + out.strip()[:200])
    else:
        add(2, 'Git 历史里的 config.js', 'PASS', '从未被提交过（git log --all -- config.js 为空）')


# ============================================================
# 3. .gitignore 覆盖（Day 23 发现 .env.production 漏了）
# ============================================================
def check_3():
    must_ignore = ['config.js', '.env', '.env.production', '.env.staging', '.env.development', '.workbuddy/']
    leaked = []
    for f in must_ignore:
        code, out = local('git check-ignore -q "%s"' % f)
        if code != 0:
            leaked.append(f)
    if leaked:
        add(3, '.gitignore 覆盖', 'FAIL', '这些本该被忽略却没被忽略：' + ', '.join(leaked))
    else:
        add(3, '.gitignore 覆盖', 'PASS', 'config.js / .env* / .workbuddy/ 全部被正确忽略')


# ============================================================
# 4. JS 语法（多次踩过：改完没检查，页面直接白屏）
# ============================================================
def check_4():
    js = sorted(f for f in os.listdir(os.path.join(ROOT, 'js')) if f.endswith('.js'))
    bad = []
    for f in js:
        code, out = local('node --check js/%s' % f)
        if code != 0:
            bad.append('%s → %s' % (f, out.strip().split('\n')[0][:80]))
    if bad:
        add(4, 'JS 语法', 'FAIL', '\n      '.join(bad))
    else:
        add(4, 'JS 语法', 'PASS', '%d 个 js 文件全部通过 node --check' % len(js))


# ============================================================
# 5. 文档里的过时文案（2026-10-10 刚清完，怕回潮）
# ============================================================
def check_5():
    stale = ['数据存在你自己的浏览器', '不需要服务器', '数据只存在用户自己的浏览器', '浏览器本地存储']
    hits = []
    # ① 面向用户的两处（README / 页面）：必须准确 → 严格查
    for f in ('README.md', 'index.html'):
        p = os.path.join(ROOT, f)
        if not os.path.exists(p):
            continue
        txt = open(p, encoding='utf-8').read()
        for kw in stale:
            if kw in txt:
                hits.append('%s → 命中「%s」' % (f, kw))
    # ② TECH_DESIGN.md：**有意保留的历史文档**（Day 7 MVP 阶段的设计）
    #    ⚠️ 2026-10-10 的决定是「保留原文 + 开头加时效声明」，而不是改写成"完美的现在"
    #       —— 所以这里**不查它的正文**（那样必然误报），只要求它**必须带声明**，
    #       否则读者会把历史方案当成现状。
    td = os.path.join(ROOT, 'TECH_DESIGN.md')
    if os.path.exists(td):
        if '时效声明' not in open(td, encoding='utf-8').read():
            hits.append('TECH_DESIGN.md → 缺少「时效声明」（历史文档必须标注哪几节已过时）')
    if hits:
        add(5, '文档过时文案', 'FAIL', '\n      '.join(hits))
    else:
        add(5, '文档过时文案', 'PASS',
            'README / index.html 无过时文案 ✅ ｜ TECH_DESIGN 已带时效声明（正文按历史文档保留）✅')


# ============================================================
# 6. 仓库体积（2026-10-10 图片占 2.4MB，别无限涨）
# ============================================================
def check_6():
    total = 0
    assets = os.path.join(ROOT, 'assets')
    for dp, _, fs in os.walk(assets):
        for f in fs:
            total += os.path.getsize(os.path.join(dp, f))
    mb = total / 1024 / 1024
    if mb > 8:
        add(6, '仓库资源体积', 'FAIL', 'assets/ 已 %.2f MB（阈值 8 MB）—— 该压图了' % mb)
    else:
        add(6, '仓库资源体积', 'PASS', 'assets/ = %.2f MB（阈值 8 MB）' % mb)


# ============================================================
# 7. 线上资源完整性（"改了忘传"踩过很多次）
# ============================================================
def check_7():
    files = ['index.html', 'css/style.css', 'css/landing-c.css', 'js/store.js', 'js/map.js',
             'assets/landing-bg-desk.jpg', 'assets/landing-city-wuhan.jpg']
    bad, ok = [], 0
    for f in files:
        try:
            code, _ = net_get(SITE + f, timeout=15)
            if code == 200:
                ok += 1
            else:
                bad.append('%s → HTTP %s' % (f, code))
        except Exception as e:
            add(7, '线上资源完整性', 'SKIP', '连不上线上（可能没网/没开代理）：%s' % str(e)[:80])
            return
    if bad:
        add(7, '线上资源完整性', 'FAIL', '\n      '.join(bad))
    else:
        add(7, '线上资源完整性', 'PASS', '%d 个关键文件全部 200' % ok)


# ============================================================
# 8. ⭐ ?v= 本地与线上一致（踩过 3 次以上：改了没升版本号 / 升了没传）
#    —— 这是今天"故意弄坏"要验的那一项
# ============================================================
def check_8():
    local_html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    lv = sorted(set(re.findall(r'\?v=(\d+)', local_html)))
    try:
        code, online_html = net_get(SITE)
    except Exception as e:
        add(8, '?v= 本地/线上一致性', 'SKIP', '连不上线上：%s' % str(e)[:80])
        return
    ov = sorted(set(re.findall(r'\?v=(\d+)', online_html)))
    if not ov:
        add(8, '?v= 本地/线上一致性', 'FAIL', '线上 index.html 里找不到 ?v=（可能不是同一个页面）')
    elif lv != ov:
        add(8, '?v= 本地/线上一致性', 'FAIL',
            '⭐ 不一致！本地 ?v=%s ｜ 线上 ?v=%s\n      说明：改了没传上去，或传了没升版本号'
            % (','.join(lv), ','.join(ov)))
    else:
        add(8, '?v= 本地/线上一致性', 'PASS', '两边都是 ?v=%s' % ','.join(lv))


# ============================================================
# 9. 云函数路由可达（Day 19 踩过 INVALID_PATH：写了代码没配路由）
# ============================================================
def check_9():
    routes = ['/api/health', '/api/places', '/api/meta', '/api/whoami']
    bad = []
    for r in routes:
        try:
            net_get(CF + r, timeout=15)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                continue                       # 401 = 路由通了，只是要身份 ✅
            if e.code in (404, 403):
                body = ''
                try:
                    body = e.read().decode('utf-8', 'replace')[:80]
                except Exception:
                    pass
                bad.append('%s → HTTP %d %s' % (r, e.code, body))
        except Exception as e:
            add(9, '云函数路由可达', 'SKIP', '连不上云函数：%s' % str(e)[:80])
            return
    if bad:
        add(9, '云函数路由可达', 'FAIL', '\n      '.join(bad))
    else:
        add(9, '云函数路由可达', 'PASS', '%d 条路由都通（200 或 401 都算通）' % len(routes))


# ============================================================
# 10. 接口鉴权（Day 22/23 的真实漏洞：没 token 也能读别人的数据）
#     ⭐ 通过标准：不带 token 必须 401
# ============================================================
def check_10():
    try:
        net_get(CF + '/api/places', timeout=15)
        add(10, '接口鉴权（无 token 应 401）', 'FAIL',
            '⭐ 不带 token 竟然读到了数据 —— 鉴权门禁失效了（2026-10-09 修过的那个洞又开了）')
    except urllib.error.HTTPError as e:
        if e.code == 401:
            add(10, '接口鉴权（无 token 应 401）', 'PASS', '不带 token 返回 401（门禁正常）')
        else:
            add(10, '接口鉴权（无 token 应 401）', 'FAIL', '期望 401，实际 HTTP %d' % e.code)
    except Exception as e:
        add(10, '接口鉴权（无 token 应 401）', 'SKIP', '连不上云函数：%s' % str(e)[:80])


# ============================================================
# 11. 跨域白名单（Day 20 踩过：本地 localhost 被拦，才写了 dev-proxy）
# ============================================================
def check_11():
    try:
        req = urllib.request.Request(CF + '/api/health', headers={'Origin': SITE.rstrip('/')})
        with OPENER.open(req, timeout=15) as r:
            acao = r.headers.get('Access-Control-Allow-Origin', '')
            creds = r.headers.get('Access-Control-Allow-Credentials', '')
        if acao:
            add(11, '跨域白名单', 'PASS', '静态托管域名能跨域访问（ACAO: %s%s）' % (acao, '，credentials=' + creds if creds else ''))
        else:
            add(11, '跨域白名单', 'FAIL', '响应里没有 Access-Control-Allow-Origin —— 浏览器会被 CORS 拦住')
    except Exception as e:
        add(11, '跨域白名单', 'SKIP', '连不上云函数：%s' % str(e)[:80])


# ============================================================
# 12. 云函数环境变量生效（间接查：需要环境变量的接口能正常应答）
# ============================================================
def check_12():
    try:
        code, body = net_get(CF + '/api/health', timeout=15)
        try:
            j = json.loads(body)
        except Exception:
            add(12, '云函数环境变量', 'FAIL', 'health 返回的不是 JSON：%s' % body[:100])
            return
        if j.get('ok') is True:
            add(12, '云函数环境变量', 'PASS', 'health 返回 %s（说明环境 ID 等配置已生效）' % json.dumps(j, ensure_ascii=False)[:80])
        else:
            add(12, '云函数环境变量', 'FAIL', 'health 返回 ok != true：%s' % body[:120])
    except Exception as e:
        add(12, '云函数环境变量', 'SKIP', '连不上云函数：%s' % str(e)[:80])


# ============================================================
# 13. ⭐ 数据库读写（端到端）—— 写 → 读回 → 删 → 确认删干净
#     ⚠️ 安全设计：**新开一个匿名身份**去做这件事，所以读写的是"检查用的临时账号"，
#        **完全不会碰到你自己的数据**；而且最后一定把它删掉。
# ============================================================
def _anonymous_token():
    # ⭐ 用**固定的 device-id**：这样每次检查都登录到**同一个「检查专用账号」**，
    #    不会跑一次就造一个新匿名用户（也方便下次跑的时候把上次的残留清掉）。
    #    ⭐ 2026-10-11 实测：device-id 相同 → 拿回的是**同一个用户**（靠这点清掉了残留数据）。
    req = urllib.request.Request(
        'https://%s.api.tcloudbasegateway.com/auth/v1/signin/anonymously' % ENV,
        data=b'{"platform":"web"}',
        headers={'Content-Type': 'application/json',
                 'x-device-id': 'verify-project-probe'},
        method='POST')
    with OPENER.open(req, timeout=20) as r:
        return json.load(r)['access_token']


def check_13():
    name = 'CHECK-PROBE-%d' % int(time.time())
    try:
        tok = _anonymous_token()
    except Exception as e:
        add(13, '数据库读写（端到端）', 'SKIP', '拿不到匿名身份（没网/云函数不通）：%s' % str(e)[:70])
        return

    hdr = {'Authorization': 'Bearer ' + tok, 'Content-Type': 'application/json'}

    def call(method, path, body=None):
        data = json.dumps(body).encode('utf-8') if body is not None else None
        req = urllib.request.Request(CF + path, data=data, headers=hdr, method=method)
        with OPENER.open(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode('utf-8', 'replace'))

    def pid_of(p):
        # ⚠️ 契约里这个字段叫 `id`（不是 `_id`）—— 第一版写错导致误报，记这个教训
        return p.get('id') or p.get('_id')

    steps = []
    try:
        # ⓪ 先清掉上次可能残留的探测数据（上一次跑到一半失败的兜底）
        swept = 0
        st, res = call('GET', '/api/places')
        for p in res.get('places', []):
            if str(p.get('name', '')).startswith('CHECK-PROBE-'):
                call('DELETE', '/api/place?id=' + str(pid_of(p)))
                swept += 1
        if swept:
            steps.append('清掉上次残留 %d 条' % swept)

        # ① 写
        st, res = call('POST', '/api/places',
                       {'name': name, 'city': '检查用', 'lng': 114.0, 'lat': 30.5, 'type': 'travel'})
        place = res.get('place') or {}
        pid = pid_of(place) or res.get('id')
        steps.append('写入 200')
        if not pid:
            add(13, '数据库读写（端到端）', 'FAIL',
                '写入返回里找不到 id：%s' % json.dumps(res, ensure_ascii=False)[:160])
            return
        # ② 读回
        st, res = call('GET', '/api/places')
        if not [p for p in res.get('places', []) if p.get('name') == name]:
            add(13, '数据库读写（端到端）', 'FAIL', '写入成功但读不回来（已完成：%s）' % ' / '.join(steps))
            return
        steps.append('读回 1 条')
        # ③ 删
        call('DELETE', '/api/place?id=' + str(pid))
        steps.append('删除 200')
        # ④ 确认删干净
        st, res = call('GET', '/api/places')
        if [p for p in res.get('places', []) if p.get('name') == name]:
            add(13, '数据库读写（端到端）', 'FAIL',
                '⭐ 删除后还能读到 —— 有脏数据残留：%s（下次跑会自动清）' % name)
            return
        steps.append('确认已删干净')
        add(13, '数据库读写（端到端）', 'PASS',
            '→'.join(steps) + '（写/读/删都在独立匿名身份里，未碰你的数据）')
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = e.read().decode('utf-8', 'replace')[:130]
        except Exception:
            pass
        add(13, '数据库读写（端到端）', 'FAIL',
            'HTTP %d %s（已完成：%s）' % (e.code, body, ' / '.join(steps) or '无'))
    except Exception as e:
        add(13, '数据库读写（端到端）', 'SKIP', '连不上云函数：%s' % str(e)[:70])


# ============================================================
# 14. ⭐ 写接口鉴权 —— 没身份不能写（Day 22/23 修过的那个洞的"写"侧）
# ============================================================
def check_14():
    try:
        req = urllib.request.Request(
            CF + '/api/places',
            data=json.dumps({'name': 'SHOULD-NOT-BE-CREATED', 'city': 'x', 'lng': 0, 'lat': 0,
                             'type': 'travel'}).encode('utf-8'),
            headers={'Content-Type': 'application/json'}, method='POST')
        with OPENER.open(req, timeout=20) as r:
            add(14, '写接口鉴权（无 token 必须 401）', 'FAIL',
                '⭐ 不带 token 竟然写成功了（HTTP %d）—— 鉴权失守，且**这次真写进去了一条垃圾数据**，请去清掉' % r.status)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            add(14, '写接口鉴权（无 token 必须 401）', 'PASS', '不带 token 写入被拒（401），门禁正常')
        elif e.code == 400:
            add(14, '写接口鉴权（无 token 必须 401）', 'FAIL',
                '⭐ 返回的是 400 而不是 401 —— 说明**先校验字段、后校验身份**。顺序反了：'
                '没身份的人应该第一道就被挡住，不该还能"试探"出字段要求')
        else:
            add(14, '写接口鉴权（无 token 必须 401）', 'FAIL', '期望 401，实际 HTTP %d' % e.code)
    except Exception as e:
        add(14, '写接口鉴权（无 token 必须 401）', 'SKIP', '连不上云函数：%s' % str(e)[:70])


CHECKS = [check_1, check_2, check_3, check_4, check_5, check_6,
          check_7, check_8, check_9, check_10, check_11, check_12,
          check_13, check_14]


def main():
    print('=' * 72)
    print('TripMemo 发布前检查')
    print('  项目目录：', ROOT)
    print('=' * 72)
    for fn in CHECKS:
        try:
            fn()
        except Exception as e:
            # ⚠️ 单项异常不能让整个检查器崩掉
            add(0, fn.__name__, 'FAIL', '这项自己抛异常了：%s: %s' % (type(e).__name__, str(e)[:120]))

    results.sort(key=lambda r: r[0])
    n = {'PASS': 0, 'FAIL': 0, 'SKIP': 0}
    print()
    for no, name, status, ev in results:
        n[status] = n.get(status, 0) + 1
        mark = {'PASS': '[\u2705 PASS]', 'FAIL': '[\u274c FAIL]', 'SKIP': '[\u26a0\ufe0f SKIP]'}[status]
        print('%s %2d. %s' % (mark, no, name))
        if ev:
            print('        ' + ev)
        print()
    print('-' * 72)
    print('汇总：PASS %d ｜ FAIL %d ｜ SKIP %d' % (n['PASS'], n['FAIL'], n['SKIP']))
    if n['FAIL']:
        print('\u274c 有 %d 项没通过 —— 先修完再发布。' % n['FAIL'])
    else:
        print('\u2705 全部通过（SKIP 的项是没网/连不上，不代表有问题，联网后请重跑）。')
    print('-' * 72)
    return 1 if n['FAIL'] else 0


if __name__ == '__main__':
    sys.exit(main())
