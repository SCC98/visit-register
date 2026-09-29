/* ============================================================
   出入登记表 · 页面逻辑
   访客端：填表 → 提交 → 成功页
   管理端：?admin=口令 → 列表 / 筛选 / 记录离开 / 导出
   ============================================================ */
(function () {
  "use strict";

  var TZ = "Asia/Shanghai";
  var TOKEN_KEY = "visit_admin_token";
  var LAST_SUBMIT_KEY = "visit_last_submit";
  var $ = function (id) { return document.getElementById(id); };
  function qsa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  /* ==================== 时间工具（统一按北京时间显示） ==================== */
  function fmtDate(d) {
    if (!d) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(d); // en-CA 输出 YYYY-MM-DD
  }
  function fmtTime(d) {
    if (!d) return "";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false
    }).format(d); // en-GB 输出 HH:mm
  }
  function fmtDT(d) {
    if (!d) return "";
    return fmtDate(d) + " " + fmtTime(d);
  }
  function todayStr() { return fmtDate(new Date()); }
  function nowTimeStr() { return fmtTime(new Date()); }
  function daysAgoStr(n) {
    var d = new Date();
    d.setTime(d.getTime() - n * 86400000);
    return fmtDate(d);
  }
  // 把 YYYY-MM-DD 与 HH:mm 按北京时间拼成真实时刻的 ISO 串
  function toISO(dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    var d = new Date(dateStr + "T" + timeStr + ":00+08:00");
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function toast(msg, ms) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("on"); }, ms || 2200);
  }

  /* ==================== 启动 ==================== */
  function boot() {
    if (!RegLib.isConfigured()) return showCfgError();
    try {
      if (!RegLib.init()) return showCfgError();
    } catch (e) {
      return showCfgError(String(e.message || e));
    }

    var params = new URLSearchParams(location.search);
    var urlToken = params.get("admin");
    var savedToken = null;
    try { savedToken = localStorage.getItem(TOKEN_KEY); } catch (e) {}

    $("boot").hidden = true;

    if (urlToken) {
      // 用网址里的口令验证；通过后记到本机，下次免输入
      runLogin(urlToken, true);
    } else if (savedToken) {
      runLogin(savedToken, true);
    } else {
      // 默认就是访客登记页
      showVisitor();
      initVisitor();
    }
  }

  function showCfgError(detail) {
    $("boot").hidden = true;
    $("cfgError").hidden = false;
    if (detail) {
      var el = document.createElement("p");
      el.style.cssText = "color:#d93843;font-size:13px;text-align:center;margin-top:10px;";
      el.textContent = "错误详情：" + detail;
      $("cfgError").querySelector(".cfg-card").appendChild(el);
    }
    return false;
  }

  /* ==================== 视图切换 ==================== */
  function hideAll() {
    $("viewVisitor").hidden = true;
    $("viewAdmin").hidden = true;
    $("viewLogin").hidden = true;
    closeSheet();
  }
  function showVisitor() {
    hideAll();
    $("viewVisitor").hidden = false;
    // 同理：标题直接写死，不依赖 config.js，避免缓存导致显示旧名称
    var t = $("vTitle");
    document.title = (t && t.textContent.trim()) || "包装检测实验室进出登记表";
  }
  function showAdmin() {
    hideAll();
    $("viewAdmin").hidden = false;
    document.title = "出入登记管理";
  }
  function showLogin() {
    hideAll();
    $("viewLogin").hidden = false;
    document.title = "管理员登录";
    setTimeout(function () { $("loginToken").focus(); }, 200);
  }

  /* ==================== 访客端 ==================== */
  var submitting = false;

  function initVisitor() {
    // 站点名称直接写在 index.html 里，不从 config.js 取。
    // 原因：GitHub Pages 对静态文件强制缓存 10 分钟，若从 config.js 运行时覆盖标题，
    // 改了名称后浏览器会仍显示旧名称（config.js 是旧的，而 HTML 是新的）。
    // 副标题/图标仍可由配置覆盖，这两个改得少。
    var cfg = window.__APP_CONFIG__ || {};
    if (cfg.SITE_SUBTITLE) $("vSub").textContent = cfg.SITE_SUBTITLE;
    if (cfg.SITE_LOGO) $("vLogo").textContent = cfg.SITE_LOGO;

    $("btnAdv").addEventListener("click", function () {
      var on = $("advBox").classList.toggle("on");
      $("btnAdv").classList.toggle("on", on);
      $("advText").textContent = on ? "收起备注" : "选填：备注";
    });

    // 到访时间默认填当前时刻
    setVisitTimeNow();
    $("btnNow").addEventListener("click", function () {
      setVisitTimeNow();
      clearBad("fld_visitTime");
      toast("已填入当前时间");
    });

    $("regForm").addEventListener("submit", onSubmit);
    $("btnAgain").addEventListener("click", resetToForm);
    $("vLock").addEventListener("click", function () {
      var t = null;
      try { t = localStorage.getItem(TOKEN_KEY); } catch (e) {}
      if (t) runLogin(t, true);
      else showLogin();
    });

    // 输入时即时清除红框
    ["i_name", "i_phone", "i_visitTime"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        $(id).classList.remove("bad");
        var f = $(id).closest(".fld");
        if (f) f.classList.remove("bad");
      });
    });

    // 回车逐个跳转，避免误提交
    $("regForm").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "submit") {
        var list = qsa("#regForm .ipt");
        var i = list.indexOf(e.target);
        if (i > -1 && i < list.length - 1) {
          e.preventDefault();
          list[i + 1].focus();
        }
      }
    });
  }

  function resetToForm() {
    $("vDoneWrap").hidden = true;
    $("vFormWrap").hidden = false;
    // 保留单位/房间/访问人/事由，只清空访客个人信息，方便连续登记同行人员
    $("i_name").value = "";
    $("i_phone").value = "";
    $("i_remark").value = "";
    setVisitTimeNow();   // 到访时间重置为当前时刻
    // 清干净上一轮校验留下的红色错误提示（输入框和字段容器两层）
    ["fld_name", "fld_phone", "fld_visitTime"].forEach(function (id) {
      clearBad(id);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(function () { $("i_name").focus(); }, 240);
  }

  // 把「到访时间」设为当前时刻（datetime-local 需要 YYYY-MM-DDTHH:mm 格式）
  function setVisitTimeNow() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    $("i_visitTime").value =
      d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function clearBad(fldId) {
    var f = $(fldId);
    if (!f) return;
    f.classList.remove("bad");
    var inp = f.querySelector(".ipt");
    if (inp) inp.classList.remove("bad");
  }

  function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    var data = {
      name: $("i_name").value.trim(),
      // 去掉空格与连字符，避免 "138-0013-8000" 这类输入造成重复提交判断失效
      phone: $("i_phone").value.replace(/[\s\-]/g, ""),
      org: $("i_org").value.trim(),
      room: $("i_room").value.trim(),
      receptionist: $("i_receptionist").value.trim(),
      reason: $("i_reason").value.trim(),
      remark: $("i_remark").value.trim(),
      visit_time: $("i_visitTime").value
    };

    // 校验
    var bad = [];
    if (!data.visit_time) bad.push("fld_visitTime");
    if (!data.name) bad.push("fld_name");
    var phoneDigits = data.phone.replace(/[\s\-]/g, "");
    if (!phoneDigits || !/^[0-9+]{6,20}$/.test(phoneDigits)) bad.push("fld_phone");
    if (bad.length) {
      bad.forEach(function (id) {
        $(id).classList.add("bad");
        var inp = $(id).querySelector(".ipt");
        if (inp) inp.classList.add("bad");
      });
      var first = $(bad[0]).querySelector(".ipt");
      if (first) first.focus();
      toast(bad.indexOf("fld_visitTime") > -1 ? "请填写到访时间"
        : (bad.indexOf("fld_name") > -1 ? "请填写姓名" : "请填写正确的手机号码"));
      return;
    }

    // 同一台手机短时间内重复提交提醒（防止误触两次）
    try {
      var last = JSON.parse(localStorage.getItem(LAST_SUBMIT_KEY) || "null");
      if (last && last.name === data.name && Date.now() - last.at < 120000) {
        if (!confirm("您刚刚已为「" + data.name + "」提交过登记，确定要再提交一次吗？")) return;
      }
    } catch (err) {}

    setSubmitting(true);
    RegLib.submitRegistration(data)
      .then(function (row) {
        try {
          localStorage.setItem(LAST_SUBMIT_KEY, JSON.stringify({ name: data.name, at: Date.now() }));
        } catch (err) {}
        showDone(row);
      })
      .catch(function (err) {
        var m = String(err.message || err);
        if (m === "DUPLICATE_SUBMIT") {
          toast("您刚刚已提交过登记，请勿重复提交", 3200);
        } else {
          toast(m, 3600);
        }
      })
      .then(function () { setSubmitting(false); });
  }

  function setSubmitting(on) {
    submitting = on;
    $("btnSubmit").disabled = on;
    $("btnSubmitText").textContent = on ? "正在提交…" : "提交登记";
    $("btnSpin").hidden = !on;
  }

  function showDone(row) {
    // 展示访客填写的到访时间；没填则回落到系统记录时间
    var vt = parseDate(row.visit_time);
    $("doneName").textContent = row.name || "访客";
    $("doneTime").textContent = vt ? fmtDT(vt) : "—";
    $("doneReceptionist").textContent = row.receptionist || "未填写";
    $("doneRoom").textContent = row.room || "未填写";
    $("doneId").textContent = String(row.id || "").slice(0, 8).toUpperCase();
    $("doneFoot").textContent = "系统记录时间：" + fmtDT(new Date());
    $("vFormWrap").hidden = true;
    $("vDoneWrap").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ==================== 登录 ==================== */
  function runLogin(token, silent) {
    if (!silent) $("loginErr").hidden = true;
    RegLib.verifyToken(token)
      .then(function (ok) {
        if (ok) {
          try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
          adminToken = token;
          showAdmin();
          initAdmin();
          loadAdmin();
        } else {
          try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
          adminToken = null;
          if (silent) { showVisitor(); initVisitor(); }
          else { $("loginErr").hidden = false; }
        }
      })
      .catch(function (err) {
        if (silent) { showVisitor(); initVisitor(); }
        else { toast(RegLib.humanize(err), 3200); }
      });
  }

  function initLoginForm() {
    $("btnLogin").addEventListener("click", function () {
      var t = $("loginToken").value.trim();
      if (!t) { $("loginErr").hidden = false; return; }
      $("btnLogin").disabled = true;
      RegLib.verifyToken(t)
        .then(function (ok) {
          $("btnLogin").disabled = false;
          if (ok) {
            try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
            adminToken = t;
            $("loginToken").value = "";
            showAdmin(); initAdmin(); loadAdmin();
          } else {
            $("loginErr").hidden = false;
          }
        })
        .catch(function (err) {
          $("btnLogin").disabled = false;
          toast(RegLib.humanize(err), 3200);
        });
    });
    $("loginToken").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("btnLogin").click();
    });
    $("btnBackVisitor").addEventListener("click", function () {
      showVisitor();
      if (!$("regForm").dataset.bound) initVisitor();
    });
  }

  /* ==================== 管理端 ==================== */
  var adminToken = null;
  var allRecords = [];
  var filtered = [];
  var adminFilter = "today";
  var adminInited = false;
  var departTarget = null;

  function initAdmin() {
    if (adminInited) return;
    adminInited = true;

    $("aRefresh").addEventListener("click", function () { loadAdmin(true); });
    $("aLogout").addEventListener("click", function () {
      if (!confirm("退出管理页？\n\n本机将不再记住口令，下次需要重新输入或重新扫码。")) return;
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      adminToken = null;
      showVisitor();
      if (!$("regForm").dataset.bound) initVisitor();
      toast("已退出管理页");
    });
    $("aChips").addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      adminFilter = b.dataset.f;
      qsa("#aChips .chip").forEach(function (c) { c.classList.toggle("on", c === b); });
      apply();
    });
    var deb = null;
    $("aSearch").addEventListener("input", function () {
      clearTimeout(deb);
      deb = setTimeout(apply, 160);
    });
    $("btnExportCsv").addEventListener("click", exportCsv);

    $("aList").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-act]");
      if (!btn) return;
      var card = btn.closest(".rec");
      if (!card) return;
      var id = card.dataset.id;
      var act = btn.dataset.act;
      if (act === "depart") openDepart(id);
      else if (act === "del") deleteRecord(id);
    });

    // 离开登记面板
    $("sheetClose").addEventListener("click", closeSheet);
    $("mask").addEventListener("click", closeSheet);
    $("d_now").addEventListener("click", function () {
      $("d_time").value = nowTimeStr();
    });
    $("btnDepartSave").addEventListener("click", saveDeparture);
  }

  function loadAdmin(showToast) {
    $("aSub").textContent = "正在加载…";
    RegLib.adminList(adminToken, { limit: 500 })
      .then(function (rows) {
        allRecords = rows.map(function (r) {
          var vt = parseDate(r.visit_time);
          return {
            id: r.id,
            // 到访时间优先；老数据没有该列时回落到系统记录时间
            visitTime: vt,
            visitDate: r.visit_date || fmtDate(vt || parseDate(r.arrived_at)),
            name: r.name || "",
            org: r.org || "",
            phone: r.phone || "",
            room: r.room || "",
            reason: r.reason || "",
            receptionist: r.receptionist || "",
            arrivedAt: parseDate(r.arrived_at),
            leftAt: parseDate(r.left_at),
            confirmedBy: r.confirmed_by || "",
            remark: r.remark || ""
          };
        });
        apply();
        if (showToast) toast("已刷新，共 " + allRecords.length + " 条记录");
      })
      .catch(function (err) {
        var m = RegLib.humanize(err);
        if (String(m).indexOf("INVALID_TOKEN") > -1) {
          toast("口令已失效，请重新登录", 3200);
          try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
          adminToken = null;
          showLogin();
          return;
        }
        $("aSub").textContent = "加载失败";
        toast(m, 3600);
      });
  }

  function passFilter(r) {
    var t = todayStr();
    if (adminFilter === "today" && r.visitDate !== t) return false;
    if (adminFilter === "week" && !(r.visitDate >= daysAgoStr(6) && r.visitDate <= t)) return false;
    if (adminFilter === "in" && r.leftAt) return false;
    return true;
  }
  function passSearch(r, q) {
    if (!q) return true;
    var hay = [r.name, r.org, r.phone, r.room, r.reason, r.receptionist, r.confirmedBy, r.remark, r.visitDate]
      .join(" ").toLowerCase();
    return hay.indexOf(q) > -1;
  }

  function apply() {
    var q = $("aSearch").value.trim().toLowerCase();
    filtered = allRecords.filter(function (r) {
      return passFilter(r) && passSearch(r, q);
    });
    // 排序以「到访时间」为准，老数据回落到系统记录时间
    filtered.sort(function (a, b) {
      var x = (a.visitTime || a.arrivedAt);
      var y = (b.visitTime || b.arrivedAt);
      return (y ? y.getTime() : 0) - (x ? x.getTime() : 0);
    });
    renderAdmin();
  }

  function renderAdmin() {
    $("aSub").innerHTML = "共 <b>" + filtered.length + "</b> 条 · 数据库合计 " + allRecords.length + " 条";

    var t = todayStr(), w = daysAgoStr(6);
    var nToday = 0, nWeek = 0, nIn = 0;
    allRecords.forEach(function (r) {
      if (r.visitDate === t) nToday++;
      if (r.visitDate >= w && r.visitDate <= t) nWeek++;
      if (!r.leftAt) nIn++;
    });
    $("cToday").textContent = nToday;
    $("cWeek").textContent = nWeek;
    $("cIn").textContent = nIn;
    $("cAll").textContent = allRecords.length;

    $("aList").innerHTML = filtered.map(recHtml).join("");
    $("aEmpty").hidden = filtered.length > 0;
  }

  function recHtml(r) {
    var inFacility = !r.leftAt;
    // 展示与停留时长计算都以「到访时间」为准；arrivedAt 是系统记录，仅作参考
    var start = r.visitTime || r.arrivedAt;
    var timeTxt = fmtTime(start) + (r.leftAt ? " → " + fmtTime(r.leftAt) : " → 进行中");
    var stay = "";
    if (start && r.leftAt) {
      var mins = Math.max(0, Math.round((r.leftAt - start) / 60000));
      stay = " · 停留 " + (mins >= 60 ? Math.floor(mins / 60) + " 小时 " + (mins % 60) + " 分" : mins + " 分钟");
    }

    var kv = "";
    kv += '<div><dt>手机号码</dt><dd class="mono">' + (r.phone ? esc(r.phone) : "—") + '</dd></div>';
    kv += '<div><dt>所到房间</dt><dd>' + (r.room ? esc(r.room) : "—") + '</dd></div>';
    kv += '<div><dt>访问人</dt><dd>' + (r.receptionist ? esc(r.receptionist) : "—") + '</dd></div>';
    kv += '<div><dt>确认人</dt><dd>' + (r.confirmedBy ? esc(r.confirmedBy) : "—") + '</dd></div>';
    kv += '<div class="wide"><dt>事由</dt><dd>' + (r.reason ? esc(r.reason) : "—") + '</dd></div>';
    if (r.remark) kv += '<div class="wide"><dt>备注</dt><dd>' + esc(r.remark) + '</dd></div>';
    // 系统记录时间只在两者不一致时显示，避免平时干扰
    if (r.arrivedAt && start && fmtTime(r.arrivedAt) !== fmtTime(start)) {
      kv += '<div class="wide"><dt>系统记录</dt><dd style="color:var(--sub2);font-size:12.5px;">实际提交 '
        + esc(fmtDT(r.arrivedAt)) + '</dd></div>';
    }

    return '<article class="rec ' + (inFacility ? "in" : "") + '" data-id="' + r.id + '">'
      + '<div class="rec-top">'
        + '<div class="rec-main">'
          + '<div class="rec-name">' + esc(r.name) + '</div>'
          + '<div class="rec-org">' + (r.org ? esc(r.org) : "（未填单位）") + '</div>'
        + '</div>'
        + '<div class="rec-side">'
          + (inFacility ? '<span class="badge">在访中</span>' : '<span class="badge out">已离开</span>')
          + '<div class="rec-time">' + esc(r.visitDate) + '</div>'
        + '</div>'
      + '</div>'
      + '<dl class="rec-kv">' + kv + '</dl>'
      + '<div class="rec-time" style="margin-top:8px;">到访 ' + esc(timeTxt) + esc(stay) + '</div>'
      + '<div class="rec-actions">'
        + (inFacility
            ? '<button type="button" class="b-depart" data-act="depart">🚪 记录离开</button>'
            : '<button type="button" data-act="depart">↺ 修改离开时间</button>')
        + '<button type="button" class="b-del" data-act="del">删除</button>'
      + '</div>'
    + '</article>';
  }

  /* ---------------- 记录离开 ---------------- */
  function openDepart(id) {
    var r = allRecords.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    departTarget = r;
    $("departWho").textContent = r.name + (r.org ? "（" + r.org + "）" : "");
    $("d_time").value = nowTimeStr();
    $("d_by").value = r.confirmedBy || "";
    $("d_remark").value = r.remark || "";
    $("mask").hidden = false;
    $("departSheet").hidden = false;
    requestAnimationFrame(function () {
      $("mask").classList.add("on");
      $("departSheet").classList.add("on");
    });
  }
  function closeSheet() {
    $("mask").classList.remove("on");
    $("departSheet").classList.remove("on");
    setTimeout(function () {
      $("mask").hidden = true;
      $("departSheet").hidden = true;
    }, 230);
  }
  function saveDeparture() {
    if (!departTarget) return;
    var t = $("d_time").value;
    if (!t) { toast("请选择离开时间"); return; }
    var iso = toISO(departTarget.visitDate, t);
    if (!iso) { toast("离开时间格式不正确"); return; }

    $("btnDepartSave").disabled = true;
    var patch = { left_at: iso };
    var by = $("d_by").value.trim();
    var rm = $("d_remark").value.trim();
    if (by) patch.confirmed_by = by;
    if (rm) patch.remark = rm;

    RegLib.adminUpdate(adminToken, departTarget.id, patch)
      .then(function () {
        $("btnDepartSave").disabled = false;
        closeSheet();
        toast("已记录「" + departTarget.name + "」离开时间 " + t);
        departTarget = null;
        loadAdmin();
      })
      .catch(function (err) {
        $("btnDepartSave").disabled = false;
        toast(RegLib.humanize(err), 3200);
      });
  }

  function deleteRecord(id) {
    var r = allRecords.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    if (!confirm("确定删除这条登记记录吗？\n\n" + r.visitDate + "  " + r.name +
                 (r.org ? "（" + r.org + "）" : "") + "\n\n删除后不可恢复。")) return;
    RegLib.adminDelete(adminToken, id)
      .then(function () {
        toast("已删除「" + r.name + "」的记录");
        loadAdmin();
      })
      .catch(function (err) { toast(RegLib.humanize(err), 3200); });
  }

  /* ---------------- 导出 ---------------- */
  // 与原始纸质表格的列对齐；「到达时间（系统记录）」放最后，供核对用
  var CSV_HEADERS = [
    "日期", "姓名", "所在单位", "手机号码", "所到房间", "事由",
    "到访时间", "离开时间", "访问人", "确认人", "备注", "到达时间（系统记录）",
  ];

  function exportCsv() {
    if (!filtered.length) { toast("当前没有可导出的记录"); return; }
    var rows = filtered.map(function (r) {
      return [
        r.visitDate,
        r.name,
        r.org,
        r.phone,
        r.room,
        r.reason,
        fmtTime(r.visitTime || r.arrivedAt),
        r.leftAt ? fmtTime(r.leftAt) : "",
        r.receptionist,
        r.confirmedBy,
        r.remark,
        fmtTime(r.arrivedAt)
      ];
    });
    var csv = [CSV_HEADERS].concat(rows).map(function (line) {
      return line.map(function (c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");

    var label = { today: "今天", week: "近7天", in: "未离开", all: "全部" }[adminFilter] || "记录";
    var name = "出入登记表_" + label + "_" + todayStr() + ".csv";
    download(name, "\ufeff" + csv, "text/csv;charset=utf-8");
    toast("已导出 " + rows.length + " 条记录，可用 Excel 打开");
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ==================== 启动 ==================== */
  // 用 dataset 标记，避免重复绑定
  $("regForm").dataset.bound = "1";
  initLoginForm();
  boot();

  // 页面重新可见时（访客从后台切回来）自动刷新管理列表
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && adminToken && !$("viewAdmin").hidden) loadAdmin();
  });
})();
