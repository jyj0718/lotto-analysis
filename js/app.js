(function () {
  "use strict";

  var draws = (window.LOTTO_DRAWS || []).slice().sort(function (a, b) { return a.no - b.no; });
  var maxRound = draws.length ? draws[draws.length - 1].no : 0;
  var drawByNo = {};
  draws.forEach(function (d) { drawByNo[d.no] = d; });

  // ---------- helpers ----------
  function ballColorClass(n) {
    if (n <= 10) return "ball-r1";
    if (n <= 20) return "ball-r2";
    if (n <= 30) return "ball-r3";
    if (n <= 40) return "ball-r4";
    return "ball-r5";
  }

  function ballEl(n, small) {
    var span = document.createElement("span");
    span.className = "ball " + ballColorClass(n) + (small ? " small" : "");
    span.textContent = n;
    return span;
  }

  function fmtMoney(v) {
    if (v === null || v === undefined) return "정보 없음";
    return Number(v).toLocaleString("ko-KR") + "원";
  }

  function fmtCount(v) {
    if (v === null || v === undefined) return "정보 없음";
    return Number(v).toLocaleString("ko-KR") + "명";
  }

  // ---------- tabs ----------
  var qrCameraHooks = { start: function () {}, stop: function () {} };
  var tabBtns = document.querySelectorAll(".tab-btn");
  var panels = document.querySelectorAll(".tab-panel");
  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabBtns.forEach(function (b) { b.classList.remove("active"); });
      panels.forEach(function (p) { p.classList.remove("active"); });
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "qrcheck") qrCameraHooks.start(); else qrCameraHooks.stop();
    });
  });

  // ---------- Tab 0: QR ticket check ----------
  (function initQrCheck() {
    var video = document.getElementById("qrVideo");
    var canvas = document.getElementById("qrCanvas");
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var overlayMsg = document.getElementById("qrOverlayMsg");
    var restartBtn = document.getElementById("qrRestartCam");
    var manualInput = document.getElementById("qrManualInput");
    var manualCheckBtn = document.getElementById("qrManualCheck");
    var resultEl = document.getElementById("qrResult");

    var stream = null;
    var scanning = false;
    var rafId = null;
    var barcodeDetector = null;
    try {
      if (typeof BarcodeDetector !== "undefined") barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
    } catch (e) { barcodeDetector = null; }

    function setOverlay(text) { overlayMsg.textContent = text || ""; }

    function stopCamera() {
      scanning = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }
      video.srcObject = null;
    }

    function startCamera() {
      stopCamera();
      setOverlay("카메라를 여는 중...");

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setOverlay(
          "이 브라우저(또는 앱 내 브라우저)는 카메라 접근을 지원하지 않습니다. " +
          "기본 브라우저(Chrome 등)에서 열어보거나, 아래에서 QR 링크를 직접 붙여넣어 확인해주세요."
        );
        return;
      }

      try {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } })
          .then(function (s) {
            stream = s;
            video.srcObject = s;
            return video.play();
          })
          .then(function () {
            setOverlay("");
            scanning = true;
            rafId = requestAnimationFrame(scanFrame);
          })
          .catch(function (err) {
            setOverlay(
              "카메라를 사용할 수 없습니다 (" + (err.name || err.message) + "). " +
              "아래에서 QR 링크를 직접 붙여넣어 확인할 수 있습니다."
            );
          });
      } catch (err) {
        setOverlay(
          "카메라를 여는 중 오류가 발생했습니다 (" + (err.name || err.message) + "). " +
          "아래에서 QR 링크를 직접 붙여넣어 확인해주세요."
        );
      }
    }

    function scanWithJsQR() {
      if (typeof jsQR !== "function") return null;
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
      return (code && code.data) ? code.data : null;
    }

    function scanFrame() {
      if (!scanning) return;
      if (video.readyState !== video.HAVE_ENOUGH_DATA || !video.videoWidth) {
        rafId = requestAnimationFrame(scanFrame);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Some Android/Chrome versions expose BarcodeDetector but its on-device
      // detector service is unavailable — detect() then just resolves empty
      // forever instead of erroring. So always fall through to jsQR on the
      // same frame rather than trusting the native API exclusively.
      if (barcodeDetector) {
        barcodeDetector.detect(canvas)
          .then(function (codes) {
            if (codes.length) { onDecoded(codes[0].rawValue); return; }
            var text = scanWithJsQR();
            if (text) { onDecoded(text); return; }
            rafId = requestAnimationFrame(scanFrame);
          })
          .catch(function () {
            var text = scanWithJsQR();
            if (text) { onDecoded(text); return; }
            rafId = requestAnimationFrame(scanFrame);
          });
      } else if (typeof jsQR === "function") {
        var text = scanWithJsQR();
        if (text) { onDecoded(text); return; }
        rafId = requestAnimationFrame(scanFrame);
      } else {
        setOverlay("이 브라우저는 QR 스캔을 지원하지 않습니다. 아래에서 링크를 직접 붙여넣어주세요.");
      }
    }

    function onDecoded(text) {
      scanning = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      setOverlay("QR 인식 완료");
      stopCamera();
      checkTicketText(text);
    }

    // Parses the (reverse-engineered, unofficial) dhlottery ticket QR payload:
    // http://m.dhlottery.co.kr/qr.do?method=winQr&v=RRRR + ("m"+12 digits) per game.
    function decodeLottoQr(text) {
      var vMatch = text.match(/[?&]v=([^&]+)/);
      var v = vMatch ? vMatch[1] : text.trim();
      var roundMatch = v.match(/^(\d{4})/);
      if (!roundMatch) return null;
      var round = parseInt(roundMatch[1], 10);
      var rest = v.slice(4);
      var delimiter = rest.indexOf("m") !== -1 ? "m" : (rest.indexOf("q") !== -1 ? "q" : null);
      if (!delimiter) return null;

      var parts = rest.split(delimiter).filter(function (p) { return p.length > 0; });
      var games = [];
      parts.forEach(function (p) {
        var digits = p.slice(0, 12);
        if (!/^\d{12}$/.test(digits)) return;
        var nums = [];
        for (var i = 0; i < 12; i += 2) nums.push(parseInt(digits.slice(i, i + 2), 10));
        games.push(nums);
      });
      if (!games.length) return null;
      return { round: round, games: games };
    }

    function tierFor(matchCount, bonusMatch) {
      if (matchCount === 6) return { tier: "1등", win: true };
      if (matchCount === 5 && bonusMatch) return { tier: "2등", win: true };
      if (matchCount === 5) return { tier: "3등", win: true };
      if (matchCount === 4) return { tier: "4등", win: true };
      if (matchCount === 3) return { tier: "5등", win: true };
      return { tier: "낙첨", win: false };
    }

    function checkTicketText(rawText) {
      resultEl.innerHTML = "";

      var parsed = decodeLottoQr(rawText);
      var officialUrl = /^https?:\/\//i.test(rawText) ? rawText : null;
      var officialLinkHtml = officialUrl
        ? '<a class="qr-official-link" href="' + officialUrl + '" target="_blank" rel="noopener">공식 사이트에서 확인하기</a>'
        : "";

      if (!parsed) {
        resultEl.innerHTML =
          '<div class="qr-game-card">' +
          "인식된 내용을 로또 티켓 형식으로 해독하지 못했습니다. 로또 용지의 QR인지 확인하고 다시 시도해주세요." +
          (officialLinkHtml ? "<br><br>" + officialLinkHtml : "") +
          "</div>";
        return;
      }

      var draw = drawByNo[parsed.round];
      if (!draw) {
        resultEl.innerHTML =
          '<div class="qr-game-card">' +
          parsed.round + "회는 아직 추첨 전이거나 보유한 데이터에 없어 자동 판정할 수 없습니다. " +
          "최신회차 데이터를 반영한 뒤 다시 시도하거나, 공식 사이트에서 확인해주세요." +
          (officialLinkHtml ? "<br><br>" + officialLinkHtml : "") +
          "</div>";
        return;
      }

      var drawSet = {};
      draw.nums.forEach(function (n) { drawSet[n] = true; });
      var labels = ["A", "B", "C", "D", "E"];

      parsed.games.forEach(function (game, idx) {
        var matchCount = 0;
        var bonusMatch = false;
        game.forEach(function (n) {
          if (drawSet[n]) matchCount++;
          if (n === draw.bonus) bonusMatch = true;
        });
        var result = tierFor(matchCount, bonusMatch);

        var card = document.createElement("div");
        card.className = "qr-game-card";
        var header = document.createElement("div");
        header.className = "game-header";
        var label = document.createElement("span");
        label.className = "game-label";
        label.textContent = (labels[idx] || idx + 1) + "게임 · " + parsed.round + "회";
        var tierEl = document.createElement("span");
        tierEl.className = "game-tier" + (result.win ? " win" : "");
        tierEl.textContent = result.tier + " (" + matchCount + "개 일치" + (bonusMatch ? " + 보너스" : "") + ")";
        header.appendChild(label);
        header.appendChild(tierEl);

        var ballsRow = document.createElement("div");
        ballsRow.className = "balls-row";
        game.slice().sort(function (a, b) { return a - b; }).forEach(function (n) {
          var el = ballEl(n);
          if (!drawSet[n]) el.classList.add("no-match");
          ballsRow.appendChild(el);
        });

        card.appendChild(header);
        card.appendChild(ballsRow);
        resultEl.appendChild(card);
      });

      resultEl.insertAdjacentHTML(
        "beforeend",
        '<div class="qr-game-card">' +
        parsed.round + "회 당첨번호: " +
        draw.nums.slice().sort(function (a, b) { return a - b; }).join(", ") + " + 보너스 " + draw.bonus +
        (officialLinkHtml ? "<br><br>" + officialLinkHtml : "") +
        "</div>"
      );
    }

    restartBtn.addEventListener("click", function () {
      resultEl.innerHTML = "";
      startCamera();
    });
    manualCheckBtn.addEventListener("click", function () {
      var text = manualInput.value.trim();
      if (!text) return;
      checkTicketText(text);
    });

    qrCameraHooks.start = function () { resultEl.innerHTML = ""; startCamera(); };
    qrCameraHooks.stop = stopCamera;
  })();

  // ---------- header ----------
  (function initHeader() {
    var subtitle = document.getElementById("subtitle");
    if (draws.length) {
      var first = draws[0], last = draws[draws.length - 1];
      subtitle.textContent =
        first.no + "회(" + first.date + ") ~ " + last.no + "회(" + last.date + ") · 총 " + draws.length + "회차";
    } else {
      subtitle.textContent = "당첨번호 데이터를 불러오지 못했습니다.";
    }
    document.getElementById("maxRound").textContent = maxRound || "-";
  })();

  // ---------- Tab 1: round lookup ----------
  (function initLookup() {
    var input = document.getElementById("roundInput");
    var result = document.getElementById("roundResult");
    input.max = maxRound;
    input.value = maxRound;

    function render(no) {
      no = Math.min(Math.max(1, no), maxRound);
      input.value = no;
      var d = drawByNo[no];
      result.innerHTML = "";
      if (!d) {
        result.textContent = no + "회 데이터를 찾을 수 없습니다.";
        return;
      }
      var title = document.createElement("p");
      title.className = "round-title";
      title.textContent = d.no + "회 당첨번호";
      var date = document.createElement("p");
      date.className = "round-date";
      date.textContent = "추첨일: " + d.date;

      var row = document.createElement("div");
      row.className = "balls-row";
      d.nums.forEach(function (n) { row.appendChild(ballEl(n)); });
      var plus = document.createElement("span");
      plus.className = "plus";
      plus.textContent = "+";
      row.appendChild(plus);
      row.appendChild(ballEl(d.bonus));

      var prize = document.createElement("div");
      prize.className = "prize-info";
      prize.innerHTML =
        "1등 당첨금(1인당): <b>" + fmtMoney(d.prize1) + "</b> · 1등 당첨자 수: <b>" + fmtCount(d.wins1) + "</b>";

      result.appendChild(title);
      result.appendChild(date);
      result.appendChild(row);
      result.appendChild(prize);
    }

    document.getElementById("roundPrev").addEventListener("click", function () {
      render(parseInt(input.value || maxRound, 10) - 1);
    });
    document.getElementById("roundNext").addEventListener("click", function () {
      render(parseInt(input.value || maxRound, 10) + 1);
    });
    document.getElementById("roundLatest").addEventListener("click", function () {
      render(maxRound);
    });
    input.addEventListener("change", function () {
      render(parseInt(input.value || maxRound, 10));
    });

    var updateBtn = document.getElementById("updateBtn");
    var updateStatus = document.getElementById("updateStatus");
    // file:// pages have no same-origin server, so they must target the known
    // local dev server explicitly. Pages served over http(s) (PC or phone, via
    // scripts/update-server.ps1) just use a relative path to whatever host they
    // were loaded from — this matters on the phone, where "localhost" would
    // wrongly mean the phone itself, not the PC.
    var UPDATE_SERVER = (location.protocol === "file:") ? "http://localhost:5310" : "";

    function isLocalHost() {
      if (location.protocol === "file:") return true;
      var h = location.hostname;
      return h === "localhost" || h === "127.0.0.1" ||
        /^192\.168\.\d+\.\d+$/.test(h) || /^10\.\d+\.\d+\.\d+$/.test(h) || /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h);
    }

    function showStatus(text, isError) {
      updateStatus.hidden = false;
      updateStatus.textContent = text;
      updateStatus.classList.toggle("error", !!isError);
    }

    function runLocalUpdate() {
      showStatus("업데이트 서버에 연결 중...", false);
      var controller = new AbortController();
      var timeoutId = setTimeout(function () { controller.abort(); }, 120000);

      fetch(UPDATE_SERVER + "/update", { signal: controller.signal })
        .then(function (res) {
          if (!res.ok) throw new Error("서버 오류 (" + res.status + ")");
          return res.json();
        })
        .then(function (data) {
          clearTimeout(timeoutId);
          if (!data.ok) throw new Error(data.error || "알 수 없는 오류");
          showStatus("업데이트 완료! 잠시 후 페이지를 새로고침합니다...", false);
          setTimeout(function () { location.reload(); }, 1200);
        })
        .catch(function (err) {
          clearTimeout(timeoutId);
          var reason = err.name === "AbortError" ? "시간 초과" : err.message;
          showStatus(
            "업데이트 서버에 연결할 수 없습니다 (" + reason + "). 먼저 로또 폴더의 '서버시작.bat'을 실행한 뒤 다시 눌러주세요.",
            true
          );
          updateBtn.disabled = false;
        });
    }

    // ---- GitHub Actions-based update for the public (GitHub Pages) deployment ----
    var GH_OWNER = "jyj0718";
    var GH_REPO = "lotto-analysis";
    var GH_WORKFLOW = "update-data.yml";
    var GH_BRANCH = "master";
    var GH_TOKEN_KEY = "lotto_gh_pat";
    var tokenSetup = document.getElementById("tokenSetup");
    var ghTokenInput = document.getElementById("ghTokenInput");
    var ghTokenSave = document.getElementById("ghTokenSave");

    function ghHeaders(token) {
      return {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      };
    }

    function pollWorkflowRun(token, sinceIso, attemptsLeft) {
      if (attemptsLeft <= 0) {
        showStatus("요청은 보냈지만 완료 확인이 오래 걸리네요. GitHub Actions 탭에서 진행 상황을 확인해보세요.", false);
        updateBtn.disabled = false;
        return;
      }
      fetch(
        "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/actions/workflows/" + GH_WORKFLOW + "/runs?per_page=1",
        { headers: ghHeaders(token) }
      )
        .then(function (res) { return res.json(); })
        .then(function (data) {
          var run = data.workflow_runs && data.workflow_runs[0];
          if (run && new Date(run.created_at) >= new Date(sinceIso)) {
            if (run.status === "completed") {
              showStatus(
                run.conclusion === "success"
                  ? "갱신 완료! 잠시 후 페이지를 새로고침합니다..."
                  : "GitHub Actions 실행이 실패했습니다 (" + run.conclusion + "). Actions 탭에서 로그를 확인해주세요.",
                run.conclusion !== "success"
              );
              if (run.conclusion === "success") setTimeout(function () { location.reload(); }, 1200);
              else updateBtn.disabled = false;
              return;
            }
            showStatus("GitHub Actions 실행 중... (" + run.status + ")", false);
          }
          setTimeout(function () { pollWorkflowRun(token, sinceIso, attemptsLeft - 1); }, 8000);
        })
        .catch(function () {
          setTimeout(function () { pollWorkflowRun(token, sinceIso, attemptsLeft - 1); }, 8000);
        });
    }

    function dispatchGithubActionsUpdate(token) {
      showStatus("GitHub Actions 실행 요청 중...", false);
      var dispatchedAt = new Date().toISOString();
      fetch(
        "https://api.github.com/repos/" + GH_OWNER + "/" + GH_REPO + "/actions/workflows/" + GH_WORKFLOW + "/dispatches",
        { method: "POST", headers: ghHeaders(token), body: JSON.stringify({ ref: GH_BRANCH }) }
      )
        .then(function (res) {
          if (res.status === 204) {
            showStatus("요청 완료! GitHub Actions에서 처리 중입니다 (1~2분 소요)...", false);
            setTimeout(function () { pollWorkflowRun(token, dispatchedAt, 18); }, 5000);
            return;
          }
          if (res.status === 401 || res.status === 403) {
            localStorage.removeItem(GH_TOKEN_KEY);
            tokenSetup.hidden = false;
            showStatus("토큰이 유효하지 않거나 권한이 부족합니다. 토큰을 다시 만들어 입력해주세요.", true);
            updateBtn.disabled = false;
            return;
          }
          return res.text().then(function (t) {
            showStatus("요청 실패 (" + res.status + "): " + t, true);
            updateBtn.disabled = false;
          });
        })
        .catch(function (err) {
          showStatus("요청 실패: " + err.message, true);
          updateBtn.disabled = false;
        });
    }

    function runGithubActionsUpdate() {
      var token = localStorage.getItem(GH_TOKEN_KEY);
      if (!token) {
        tokenSetup.hidden = false;
        showStatus("먼저 아래 안내에 따라 GitHub 토큰을 입력해주세요.", false);
        updateBtn.disabled = false;
        return;
      }
      dispatchGithubActionsUpdate(token);
    }

    ghTokenSave.addEventListener("click", function () {
      var token = ghTokenInput.value.trim();
      if (!token) return;
      localStorage.setItem(GH_TOKEN_KEY, token);
      ghTokenInput.value = "";
      tokenSetup.hidden = true;
      updateBtn.disabled = true;
      dispatchGithubActionsUpdate(token);
    });

    updateBtn.addEventListener("click", function () {
      updateBtn.disabled = true;
      tokenSetup.hidden = true;
      if (isLocalHost()) {
        runLocalUpdate();
      } else {
        runGithubActionsUpdate();
      }
    });

    render(maxRound);
  })();

  // ---------- frequency & pattern stats (shared) ----------
  var freq = new Array(46).fill(0); // index 1..45
  draws.forEach(function (d) {
    d.nums.forEach(function (n) { freq[n]++; });
  });

  // co-occurrence matrix: coMatrix[a][b] = number of draws containing both a and b
  var coMatrix = [];
  for (var ci = 0; ci <= 45; ci++) coMatrix.push(new Array(46).fill(0));
  draws.forEach(function (d) {
    var nums = d.nums;
    for (var a = 0; a < nums.length; a++) {
      for (var b = a + 1; b < nums.length; b++) {
        coMatrix[nums[a]][nums[b]]++;
        coMatrix[nums[b]][nums[a]]++;
      }
    }
  });

  // odd-count histogram: how many draws have 0..6 odd numbers among the 6 main numbers
  var oddCountDist = new Array(7).fill(0);
  // consecutive-pair histogram: how many draws have 0..5 adjacent-value pairs (e.g. 12 & 13)
  var consecutiveDist = new Array(6).fill(0);
  draws.forEach(function (d) {
    var sorted = d.nums.slice().sort(function (a, b) { return a - b; });
    var oddCount = sorted.filter(function (n) { return n % 2 === 1; }).length;
    oddCountDist[oddCount]++;

    var consecutivePairs = 0;
    for (var k = 0; k < sorted.length - 1; k++) {
      if (sorted[k + 1] === sorted[k] + 1) consecutivePairs++;
    }
    consecutiveDist[Math.min(consecutivePairs, 5)]++;
  });

  function renderRankGrid(containerId, order) {
    var container = document.getElementById(containerId);
    var items = [];
    for (var n = 1; n <= 45; n++) items.push({ n: n, count: freq[n] });
    items.sort(function (a, b) { return order === "desc" ? b.count - a.count : a.count - b.count; });

    container.innerHTML = "";
    items.forEach(function (item, idx) {
      var row = document.createElement("div");
      row.className = "rank-item";
      var rank = document.createElement("span");
      rank.className = "rank-no";
      rank.textContent = (idx + 1) + ".";
      var pct = draws.length ? ((item.count / draws.length) * 100).toFixed(1) : "0.0";
      var countEl = document.createElement("span");
      countEl.className = "rank-count";
      countEl.textContent = item.count + "회 (" + pct + "%)";
      row.appendChild(rank);
      row.appendChild(ballEl(item.n, true));
      row.appendChild(countEl);
      container.appendChild(row);
    });
  }

  renderRankGrid("mostResult", "desc");
  renderRankGrid("leastResult", "asc");

  // ---------- Tab 2: consecutive-week streak frequency ----------
  (function initStreak() {
    var streakCount = new Array(46).fill(0);
    var pairCount = 0;
    for (var i = 0; i < draws.length - 1; i++) {
      var a = draws[i], b = draws[i + 1];
      if (b.no !== a.no + 1) continue; // only truly consecutive rounds
      pairCount++;
      var setA = {};
      a.nums.forEach(function (n) { setA[n] = true; });
      b.nums.forEach(function (n) { if (setA[n]) streakCount[n]++; });
    }

    var container = document.getElementById("streakResult");
    var items = [];
    for (var n = 1; n <= 45; n++) items.push({ n: n, count: streakCount[n] });
    items.sort(function (a, b) { return b.count - a.count; });

    container.innerHTML = "";
    items.forEach(function (item, idx) {
      var row = document.createElement("div");
      row.className = "rank-item";
      var rank = document.createElement("span");
      rank.className = "rank-no";
      rank.textContent = (idx + 1) + ".";
      var countEl = document.createElement("span");
      countEl.className = "rank-count";
      countEl.textContent = item.count + "회";
      row.appendChild(rank);
      row.appendChild(ballEl(item.n, true));
      row.appendChild(countEl);
      container.appendChild(row);
    });
  })();

  // ---------- Tab 5: regional map ----------
  (function initMap() {
    var map = window.KR_MAP;
    var regions = window.LOTTO_REGIONS;
    var wrap = document.getElementById("mapSvgWrap");
    var tooltip = document.getElementById("mapTooltip");
    var rankingEl = document.getElementById("mapRanking");
    var detailEl = document.getElementById("mapRoundDetail");
    var descEl = document.getElementById("mapDesc");
    var roundInput = document.getElementById("mapRoundInput");

    if (!map || !map.provinces || !map.provinces.length) {
      wrap.textContent = "지도 데이터를 불러오지 못했습니다.";
      return;
    }
    var counts = (regions && regions.counts) || {};
    var byRound = (regions && regions.byRound) || {};
    var dataMinRound = regions && regions.roundRange ? regions.roundRange[0] : null;
    var dataMaxRound = regions && regions.roundRange ? regions.roundRange[1] : null;

    if (regions && regions.roundRange) {
      descEl.textContent =
        "1등 당첨 배출점 주소 기준 지역(시/도)별 당첨 횟수입니다. (" +
        regions.roundRange[0] + "회 ~ " + regions.roundRange[1] + "회, 배출점 정보가 공개된 회차 기준. " +
        "인터넷(동행복권 사이트) 구매로 당첨된 " + (regions.onlineWins || 0) + "건은 특정 지역에 속하지 않아 지도에서 제외됨)";
    }

    var nameByCode = {};
    map.provinces.forEach(function (p) { nameByCode[p.code] = p.name; });
    function shortName(name) { return name.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, ""); }

    var aggMaxCount = 0;
    map.provinces.forEach(function (p) {
      var c = counts[p.code] || 0;
      if (c > aggMaxCount) aggMaxCount = c;
    });

    function colorScale(count, max, from, to) {
      if (!max || !count) return "#e2e4e8";
      var t = count / max;
      var rgb = from.map(function (c0, i) { return Math.round(c0 + (to[i] - c0) * t); });
      return "rgb(" + rgb.join(",") + ")";
    }
    function aggColorFor(count) { return colorScale(count, aggMaxCount, [222, 234, 250], [37, 99, 235]); }
    function roundColorFor(count, max) { return colorScale(count, max, [255, 228, 196], [217, 68, 24]); }

    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + map.width + " " + map.height);
    wrap.innerHTML = "";
    wrap.appendChild(svg);

    var pathByCode = {};
    map.provinces.forEach(function (p) {
      var path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", p.d);
      path.setAttribute("data-code", p.code);
      pathByCode[p.code] = path;
      path.addEventListener("mouseenter", function () { describeRegion(p.code); });
      path.addEventListener("click", function () { describeRegion(p.code); });
      svg.appendChild(path);
    });

    var mode = "aggregate"; // "aggregate" | "round"
    var ranked = [];
    var currentRoundCounts = {};
    var currentRoundMax = 0;

    function describeRegion(code) {
      if (mode === "aggregate") {
        var count = counts[code] || 0;
        var rank = ranked.findIndex(function (r) { return r.code === code; }) + 1;
        tooltip.innerHTML =
          "<b>" + nameByCode[code] + "</b>" +
          "누적 당첨(1등 배출) 횟수: " + count + "회" +
          (count ? "<br>전체 " + map.provinces.length + "개 지역 중 " + rank + "위" : "");
      } else {
        var c = currentRoundCounts[code] || 0;
        tooltip.innerHTML =
          "<b>" + nameByCode[code] + "</b>" +
          (c ? "이번 회차 1등 배출: " + c + "건" : "이번 회차에는 당첨 배출점이 없습니다.");
      }
    }

    function renderAggregate() {
      mode = "aggregate";
      map.provinces.forEach(function (p) {
        pathByCode[p.code].setAttribute("fill", aggColorFor(counts[p.code] || 0));
      });

      ranked = map.provinces
        .map(function (p) { return { code: p.code, name: p.name, count: counts[p.code] || 0 }; })
        .sort(function (a, b) { return b.count - a.count; });

      detailEl.hidden = true;
      rankingEl.hidden = false;
      rankingEl.innerHTML = "";
      ranked.forEach(function (r, idx) {
        var li = document.createElement("li");
        var bar = document.createElement("span");
        bar.className = "bar";
        bar.style.width = (aggMaxCount ? (r.count / aggMaxCount) * 60 : 0) + 20 + "px";
        bar.style.background = aggColorFor(r.count);
        var name = document.createElement("span");
        name.className = "region-name";
        name.textContent = (idx + 1) + ". " + shortName(r.name);
        var count = document.createElement("span");
        count.className = "region-count";
        count.textContent = r.count + "회";

        li.appendChild(name);
        li.appendChild(bar);
        li.appendChild(count);
        li.addEventListener("mouseenter", function () { describeRegion(r.code); });
        rankingEl.appendChild(li);
      });

      tooltip.textContent = "지역을 클릭하거나 마우스를 올려보세요.";
    }

    function renderRound(no) {
      mode = "round";
      rankingEl.hidden = true;
      detailEl.hidden = false;

      var stores = byRound["" + no];
      currentRoundCounts = {};
      currentRoundMax = 0;

      if (stores === undefined) {
        map.provinces.forEach(function (p) { pathByCode[p.code].setAttribute("fill", "#e2e4e8"); });
        var noDataMsg = (dataMinRound && no < dataMinRound)
          ? "배출점 정보는 " + dataMinRound + "회부터 제공됩니다."
          : "이 회차의 배출점 정보를 찾을 수 없습니다.";
        detailEl.innerHTML = '<h4>' + no + '회 1등 배출 지역</h4><p class="empty-note">' + noDataMsg + '</p>';
        tooltip.textContent = "지역을 클릭하거나 마우스를 올려보세요.";
        return;
      }

      stores.forEach(function (s) {
        if (!s.region) return;
        currentRoundCounts[s.region] = (currentRoundCounts[s.region] || 0) + 1;
        if (currentRoundCounts[s.region] > currentRoundMax) currentRoundMax = currentRoundCounts[s.region];
      });

      map.provinces.forEach(function (p) {
        pathByCode[p.code].setAttribute("fill", roundColorFor(currentRoundCounts[p.code] || 0, currentRoundMax));
      });

      var onlineCount = stores.filter(function (s) { return !s.region; }).length;
      var html = "<h4>" + no + "회 1등 배출 지역 (" + stores.length + "건)</h4>";
      if (!stores.length) {
        html += '<p class="empty-note">이 회차는 1등 당첨자가 없거나 정보가 없습니다.</p>';
      } else {
        html += '<ul class="store-list">';
        stores.forEach(function (s) {
          var badge = s.region
            ? '<span class="store-region">' + shortName(nameByCode[s.region] || s.region) + '</span>'
            : '<span class="store-region online">온라인</span>';
          html +=
            "<li>" + badge +
            '<span class="store-name">' + s.name + '</span>' +
            '<span class="store-address">' + s.address + '</span></li>';
        });
        html += "</ul>";
      }
      if (onlineCount) {
        html += '<p class="empty-note">(인터넷 구매 ' + onlineCount + '건은 지도에 표시되지 않음)</p>';
      }
      detailEl.innerHTML = html;
      tooltip.textContent = "지역을 클릭하거나 마우스를 올려보세요.";
    }

    renderAggregate();

    // ---- round lookup controls ----
    roundInput.max = maxRound;
    roundInput.value = dataMaxRound || maxRound;

    function goToRound(no) {
      no = Math.min(Math.max(1, no), maxRound);
      roundInput.value = no;
      renderRound(no);
    }

    document.getElementById("mapRoundPrev").addEventListener("click", function () {
      goToRound(parseInt(roundInput.value || maxRound, 10) - 1);
    });
    document.getElementById("mapRoundNext").addEventListener("click", function () {
      goToRound(parseInt(roundInput.value || maxRound, 10) + 1);
    });
    document.getElementById("mapRoundLatest").addEventListener("click", function () {
      goToRound(maxRound);
    });
    document.getElementById("mapRoundClear").addEventListener("click", function () {
      renderAggregate();
    });
    roundInput.addEventListener("change", function () {
      goToRound(parseInt(roundInput.value || maxRound, 10));
    });
  })();

  // ---------- Tab 6: co-occurrence (pair) analysis ----------
  (function initPair() {
    var picker = document.getElementById("pairPicker");
    var summary = document.getElementById("pairSummary");
    var result = document.getElementById("pairResult");

    var ballButtons = {};
    for (var n = 1; n <= 45; n++) {
      (function (n) {
        var b = ballEl(n);
        b.tabIndex = 0;
        b.addEventListener("click", function () { selectNumber(n); });
        ballButtons[n] = b;
        picker.appendChild(b);
      })(n);
    }

    function selectNumber(n) {
      for (var k = 1; k <= 45; k++) ballButtons[k].classList.toggle("selected", k === n);

      summary.classList.remove("empty");
      summary.textContent =
        n + "번은 1회부터 최신 회차까지 총 " + freq[n] + "회 나왔습니다. 아래는 그 회차들에서 함께 나온 번호 순위입니다.";

      var items = [];
      for (var m = 1; m <= 45; m++) {
        if (m === n) continue;
        items.push({ n: m, count: coMatrix[n][m] });
      }
      items.sort(function (x, y) { return y.count - x.count; });

      result.innerHTML = "";
      items.forEach(function (item, idx) {
        var row = document.createElement("div");
        row.className = "rank-item";
        var rank = document.createElement("span");
        rank.className = "rank-no";
        rank.textContent = (idx + 1) + ".";
        var pct = freq[n] ? ((item.count / freq[n]) * 100).toFixed(1) : "0.0";
        var countEl = document.createElement("span");
        countEl.className = "rank-count";
        countEl.textContent = item.count + "회 (" + pct + "%)";
        row.appendChild(rank);
        row.appendChild(ballEl(item.n, true));
        row.appendChild(countEl);
        result.appendChild(row);
      });
    }

    summary.classList.add("empty");
    summary.textContent = "위에서 번호를 하나 선택하면 동반출현 순위가 표시됩니다.";
  })();

  // ---------- Tab 7: pattern-based next-round prediction ----------
  (function initPredict() {
    var SET_COUNT = 5;
    var oddPool = [], evenPool = [];
    for (var n = 1; n <= 45; n++) (n % 2 === 1 ? oddPool : evenPool).push(n);

    // exact combinations that have already won 1st place historically — never regenerate these
    var pastCombos = {};
    draws.forEach(function (d) {
      var key = d.nums.slice().sort(function (a, b) { return a - b; }).join(",");
      pastCombos[key] = d.no;
    });

    function renderHistogram(containerId, dist) {
      var container = document.getElementById(containerId);
      var total = dist.reduce(function (a, b) { return a + b; }, 0);
      var max = Math.max.apply(null, dist);
      container.innerHTML = "";
      dist.forEach(function (count, idx) {
        var col = document.createElement("div");
        col.className = "hist-col";
        var pct = document.createElement("span");
        pct.className = "hist-pct";
        pct.textContent = total ? ((count / total) * 100).toFixed(0) + "%" : "0%";
        var wrap = document.createElement("div");
        wrap.className = "hist-bar-wrap";
        var bar = document.createElement("div");
        bar.className = "hist-bar";
        bar.style.height = (max ? (count / max) * 100 : 0) + "%";
        wrap.appendChild(bar);
        var label = document.createElement("span");
        label.className = "hist-label";
        label.textContent = idx + "개";
        col.appendChild(pct);
        col.appendChild(wrap);
        col.appendChild(label);
        container.appendChild(col);
      });
    }
    renderHistogram("oddDistChart", oddCountDist);
    renderHistogram("consecutiveDistChart", consecutiveDist);

    // ---- single best-pick combination: hill-climbing over a composite score ----
    // score combines 4 equally-weighted signals: average historical frequency,
    // average internal co-occurrence, how common the odd/even split is, and how
    // common the consecutive-pair count is — each normalized so ~1.0 is "average".
    var avgFreq = freq.slice(1, 46).reduce(function (a, b) { return a + b; }, 0) / 45;
    var pairCoTotal = 0, pairCoCount = 0;
    for (var pi = 1; pi <= 45; pi++) {
      for (var pj = pi + 1; pj <= 45; pj++) { pairCoTotal += coMatrix[pi][pj]; pairCoCount++; }
    }
    var avgPairCo = pairCoTotal / pairCoCount;
    var maxOddProb = Math.max.apply(null, oddCountDist);
    var maxConsecutiveProb = Math.max.apply(null, consecutiveDist);

    function countConsecutiveLocal(sorted) {
      var c = 0;
      for (var i = 0; i < sorted.length - 1; i++) {
        if (sorted[i + 1] === sorted[i] + 1) c++;
      }
      return c;
    }

    function scoreComponents(sortedNums) {
      var freqSum = 0;
      sortedNums.forEach(function (n) { freqSum += freq[n]; });
      var freqComponent = (freqSum / 6) / avgFreq;

      var coSum = 0, pairs = 0;
      for (var i = 0; i < sortedNums.length; i++) {
        for (var j = i + 1; j < sortedNums.length; j++) {
          coSum += coMatrix[sortedNums[i]][sortedNums[j]];
          pairs++;
        }
      }
      var coComponent = (coSum / pairs) / avgPairCo;

      var oddCount = sortedNums.filter(function (n) { return n % 2 === 1; }).length;
      var oddEvenComponent = oddCountDist[oddCount] / maxOddProb;

      var consec = countConsecutiveLocal(sortedNums);
      var consecComponent = consecutiveDist[Math.min(consec, 5)] / maxConsecutiveProb;

      return { freqComponent: freqComponent, coComponent: coComponent, oddEvenComponent: oddEvenComponent, consecComponent: consecComponent, oddCount: oddCount, consec: consec };
    }

    function scoreOf(sortedNums) {
      if (pastCombos[sortedNums.join(",")]) return -Infinity;
      var c = scoreComponents(sortedNums);
      return c.freqComponent + c.coComponent + c.oddEvenComponent + c.consecComponent;
    }

    function sortNums(arr) { return arr.slice().sort(function (a, b) { return a - b; }); }

    function randomInitialSet() {
      var pool = [];
      for (var n = 1; n <= 45; n++) pool.push(n);
      for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
      }
      return pool.slice(0, 6);
    }

    function hillClimbOnce() {
      var current = randomInitialSet();
      var currentScore = scoreOf(sortNums(current));
      var improved = true;
      while (improved) {
        improved = false;
        var bestScore = currentScore;
        var bestPos = -1, bestVal = -1;
        for (var pos = 0; pos < 6; pos++) {
          for (var cand = 1; cand <= 45; cand++) {
            if (current.indexOf(cand) !== -1) continue;
            var trial = current.slice();
            trial[pos] = cand;
            var s = scoreOf(sortNums(trial));
            if (s > bestScore) { bestScore = s; bestPos = pos; bestVal = cand; }
          }
        }
        if (bestPos !== -1) {
          current[bestPos] = bestVal;
          currentScore = bestScore;
          improved = true;
        }
      }
      return { nums: sortNums(current), score: currentScore };
    }

    function findBestPick(restarts) {
      var best = null;
      for (var r = 0; r < restarts; r++) {
        var result = hillClimbOnce();
        if (!best || result.score > best.score) best = result;
      }
      return best;
    }

    function renderBestPick() {
      var best = findBestPick(120);
      var comp = scoreComponents(best.nums);
      var container = document.getElementById("bestPickResult");
      container.innerHTML = "";

      var ballsRow = document.createElement("div");
      ballsRow.className = "balls-row";
      best.nums.forEach(function (n) { ballsRow.appendChild(ballEl(n)); });

      var breakdown = document.createElement("div");
      breakdown.className = "score-breakdown";
      function scoreItem(label, value) {
        var box = document.createElement("div");
        box.className = "score-item";
        var l = document.createElement("span");
        l.className = "label";
        l.textContent = label;
        var v = document.createElement("span");
        v.className = "value";
        v.textContent = value;
        box.appendChild(l);
        box.appendChild(v);
        return box;
      }
      breakdown.appendChild(scoreItem("평균 출현빈도", (comp.freqComponent * 100).toFixed(0) + "% (전체 평균 대비)"));
      breakdown.appendChild(scoreItem("동반출현 지수", (comp.coComponent * 100).toFixed(0) + "% (전체 평균 대비)"));
      breakdown.appendChild(scoreItem("홀짝 비율", "홀" + comp.oddCount + ":짝" + (6 - comp.oddCount) + " (역대 " + (oddCountDist[comp.oddCount] / draws.length * 100).toFixed(1) + "%)"));
      breakdown.appendChild(scoreItem("연속번호 쌍", comp.consec + "개 (역대 " + (consecutiveDist[Math.min(comp.consec, 5)] / draws.length * 100).toFixed(1) + "%)"));

      container.appendChild(ballsRow);
      container.appendChild(breakdown);
    }

    document.getElementById("bestPickRecalc").addEventListener("click", renderBestPick);
    renderBestPick();

    function weightedPick(candidates, weightFn) {
      var weights = candidates.map(weightFn);
      var total = weights.reduce(function (a, b) { return a + b; }, 0);
      var r = Math.random() * total;
      for (var i = 0; i < candidates.length; i++) {
        r -= weights[i];
        if (r <= 0) return candidates[i];
      }
      return candidates[candidates.length - 1];
    }

    function sampleOddTarget() {
      var total = oddCountDist.reduce(function (a, b) { return a + b; }, 0);
      var r = Math.random() * total;
      for (var i = 0; i < oddCountDist.length; i++) {
        r -= oddCountDist[i];
        if (r <= 0) return i;
      }
      return 3;
    }

    function weightFor(n, picked) {
      var w = freq[n] || 1;
      picked.forEach(function (p) { w += coMatrix[n][p]; });
      return w;
    }

    function countConsecutive(sorted) {
      var c = 0;
      for (var i = 0; i < sorted.length - 1; i++) {
        if (sorted[i + 1] === sorted[i] + 1) c++;
      }
      return c;
    }

    function generateOneSet() {
      var fallback = null; // best non-past-winner candidate found so far, even if it breaks other soft rules
      for (var attempt = 0; attempt < 50; attempt++) {
        var targetOdd = sampleOddTarget();
        var remainingOdd = targetOdd;
        var remainingEven = 6 - targetOdd;
        var picked = [];

        while (picked.length < 6) {
          var useOdd = Math.random() < (remainingOdd / (remainingOdd + remainingEven || 1));
          if (remainingEven === 0) useOdd = true;
          if (remainingOdd === 0) useOdd = false;
          var pool = (useOdd ? oddPool : evenPool).filter(function (x) { return picked.indexOf(x) === -1; });
          var pick = weightedPick(pool, function (x) { return weightFor(x, picked); });
          picked.push(pick);
          if (useOdd) remainingOdd--; else remainingEven--;
        }

        var sorted = picked.slice().sort(function (a, b) { return a - b; });
        if (pastCombos[sorted.join(",")]) continue; // never regenerate an exact historical 1st-place combo

        var consecutivePairs = countConsecutive(sorted);
        var candidate = { nums: sorted, consecutivePairs: consecutivePairs };
        if (consecutivePairs <= 3) return candidate;
        if (!fallback) fallback = candidate;
      }
      return fallback;
    }

    function renderSets() {
      var resultEl = document.getElementById("predictResult");
      resultEl.innerHTML = "";
      for (var i = 0; i < SET_COUNT; i++) {
        var set = generateOneSet();
        var oddCount = set.nums.filter(function (n) { return n % 2 === 1; }).length;
        var sum = set.nums.reduce(function (a, b) { return a + b; }, 0);

        var row = document.createElement("div");
        row.className = "predict-set";
        var label = document.createElement("span");
        label.className = "set-label";
        label.textContent = (i + 1) + ".";
        var ballsRow = document.createElement("span");
        ballsRow.className = "balls-row";
        set.nums.forEach(function (n) { ballsRow.appendChild(ballEl(n)); });
        var meta = document.createElement("span");
        meta.className = "set-meta";
        meta.textContent =
          "홀" + oddCount + ":짝" + (6 - oddCount) + " · 연속쌍 " + set.consecutivePairs + "개 · 합계 " + sum;

        row.appendChild(label);
        row.appendChild(ballsRow);
        row.appendChild(meta);
        resultEl.appendChild(row);
      }
    }

    document.getElementById("predictGenerate").addEventListener("click", renderSets);
    renderSets();

    // ---- high-frequency base numbers + their top co-occurring partners ----
    var FREQ_POOL_SIZE = 15;
    var CO_POOL_SIZE = 15;
    var freqRanked = [];
    for (var fn = 1; fn <= 45; fn++) freqRanked.push(fn);
    freqRanked.sort(function (a, b) { return freq[b] - freq[a]; });
    var freqPool = freqRanked.slice(0, FREQ_POOL_SIZE);

    function pickWeightedN(pool, count, weightFn) {
      var remaining = pool.slice();
      var picked = [];
      for (var i = 0; i < count && remaining.length; i++) {
        var choice = weightedPick(remaining, weightFn);
        picked.push(choice);
        remaining.splice(remaining.indexOf(choice), 1);
      }
      return picked;
    }

    function generateFreqComboSet() {
      for (var attempt = 0; attempt < 50; attempt++) {
        var baseCount = Math.random() < 0.5 ? 3 : 4;
        var baseNumbers = pickWeightedN(freqPool, baseCount, function (n) { return freq[n]; });

        var coCandidates = [];
        for (var n = 1; n <= 45; n++) {
          if (baseNumbers.indexOf(n) !== -1) continue;
          var score = 0;
          baseNumbers.forEach(function (b) { score += coMatrix[n][b]; });
          coCandidates.push({ n: n, score: score });
        }
        coCandidates.sort(function (a, b) { return b.score - a.score; });
        var coWeights = {};
        coCandidates.forEach(function (c) { coWeights[c.n] = c.score || 1; });
        var coPool = coCandidates.slice(0, CO_POOL_SIZE).map(function (c) { return c.n; });

        var extraNumbers = pickWeightedN(coPool, 6 - baseCount, function (n) { return coWeights[n]; });
        var combined = baseNumbers.concat(extraNumbers);
        var sorted = combined.slice().sort(function (a, b) { return a - b; });
        if (pastCombos[sorted.join(",")]) continue; // never regenerate an exact historical 1st-place combo

        return { nums: sorted, baseNumbers: baseNumbers };
      }
      return null;
    }

    function renderFreqCombo() {
      var resultEl = document.getElementById("freqComboResult");
      resultEl.innerHTML = "";
      for (var i = 0; i < SET_COUNT; i++) {
        var set = generateFreqComboSet();
        if (!set) continue;

        var row = document.createElement("div");
        row.className = "predict-set";
        var label = document.createElement("span");
        label.className = "set-label";
        label.textContent = (i + 1) + ".";
        var ballsRow = document.createElement("span");
        ballsRow.className = "balls-row";
        set.nums.forEach(function (n) {
          var el = ballEl(n);
          if (set.baseNumbers.indexOf(n) !== -1) el.classList.add("ball-base");
          ballsRow.appendChild(el);
        });
        var baseSorted = set.baseNumbers.slice().sort(function (a, b) { return a - b; });
        var meta = document.createElement("span");
        meta.className = "set-meta";
        meta.textContent =
          "고빈도 " + baseSorted.length + "개(" + baseSorted.join(",") + ") + 동반출현 " + (6 - baseSorted.length) + "개";

        row.appendChild(label);
        row.appendChild(ballsRow);
        row.appendChild(meta);
        resultEl.appendChild(row);
      }
    }

    document.getElementById("freqComboGenerate").addEventListener("click", renderFreqCombo);
    renderFreqCombo();
  })();
})();
