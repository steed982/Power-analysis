(function () {
  "use strict";

  var STORAGE_KEY = "power-analy-mvp-projects-v2";
  var LEGACY_STORAGE_KEY = "power-analy-mvp-scenarios-v1";
  var MAX_PROJECTS = 20;
  var SAVE_STATUS_CLEAR_MS = 1500;

  var MODE_LABELS = {
    sleep: "休眠唤醒",
    aor: "AOR",
    always: "长电",
    smart: "智能"
  };

  var PLATFORM_LABELS = {
    "6920": "6920",
    "6921": "6921",
    "6941": "6941",
    "OV8000": "OV8000",
    other: "其他"
  };

  var WIRELESS_LABELS = {
    wifi: "Wi-Fi",
    "4g": "4G"
  };

  var state = {
    selectedProjectId: null,
    projects: [],
    chart: null
  };

  var refs = {};
  var saveStatusTimer = null;

  function uid() {
    return "prj_" + Math.random().toString(36).slice(2, 9);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function round(value, digits) {
    var factor = Math.pow(10, digits || 0);
    return Math.round((Number(value) || 0) * factor) / factor;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function safeNumber(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function setSaveStatus(text) {
    if (!refs.saveStatus) return;
    refs.saveStatus.textContent = text || "";
    if (saveStatusTimer) {
      clearTimeout(saveStatusTimer);
      saveStatusTimer = null;
    }
    if (text) {
      saveStatusTimer = setTimeout(function () {
        if (refs.saveStatus) refs.saveStatus.textContent = "";
      }, SAVE_STATUS_CLEAR_MS);
    }
  }

  function getAllowedModesByPlatform(platform) {
    if (platform === "OV8000") {
      return ["sleep", "always"];
    }
    return ["sleep", "aor", "always", "smart"];
  }

  function getSleepPowerByWirelessType(wirelessType) {
    return wirelessType === "wifi" ? 2 : 6;
  }

  function applyWirelessSleepPower(input) {
    input.sleepPowerMw = getSleepPowerByWirelessType(input.wirelessType);
    return input;
  }

  function enforceModeByPlatform(input) {
    var allowedModes = getAllowedModesByPlatform(input.hardwarePlatform);
    var adjusted = false;
    var message = "";

    if (allowedModes.indexOf(input.mode) === -1) {
      input.mode = "sleep";
      adjusted = true;
      if (input.hardwarePlatform === "OV8000") {
        message = "OV8000 仅支持休眠唤醒/长电模式，已自动切换为休眠唤醒。";
      }
    }

    return { input: input, adjusted: adjusted, message: message };
  }

  function defaultInput() {
    return {
      mode: "smart",
      wirelessType: "4g",
      hardwarePlatform: "6920",
      batteryMah: 5200,
      voltageV: 3.7,
      efficiencyPct: 85,
      activePowerMw: 925,
      wakeCountPerDay: 50,
      wakeDurationSec: 10,
      sleepPowerMw: 6,
      aorPowerMw: 35,
      smartThresholdPct: 40
    };
  }

  function normalizeInput(raw, options) {
    var opts = options || {};
    var normalized = {
      mode: raw.mode || "smart",
      wirelessType: raw.wirelessType === "wifi" ? "wifi" : "4g",
      hardwarePlatform: PLATFORM_LABELS[raw.hardwarePlatform] ? raw.hardwarePlatform : "6920",
      batteryMah: safeNumber(raw.batteryMah, 5200),
      voltageV: safeNumber(raw.voltageV, 3.7),
      efficiencyPct: safeNumber(raw.efficiencyPct, 85),
      activePowerMw: safeNumber(raw.activePowerMw, 925),
      wakeCountPerDay: safeNumber(raw.wakeCountPerDay, 50),
      wakeDurationSec: safeNumber(raw.wakeDurationSec, 10),
      sleepPowerMw: safeNumber(raw.sleepPowerMw, 6),
      aorPowerMw: safeNumber(raw.aorPowerMw, 35),
      smartThresholdPct: clamp(safeNumber(raw.smartThresholdPct, 40), 0, 100)
    };

    applyWirelessSleepPower(normalized);
    var enforcement = enforceModeByPlatform(normalized);
    var adjustments = [];
    if (enforcement.adjusted && !opts.silentAdjustments && enforcement.message) {
      adjustments.push(enforcement.message);
    }

    return { input: normalized, adjustments: adjustments };
  }

  function validateInput(input) {
    var issues = [];
    var warnings = [];

    if (input.batteryMah <= 0) issues.push("电池电量必须大于 0。");
    if (input.voltageV <= 0) issues.push("工作电压必须大于 0。");
    if (input.efficiencyPct <= 0 || input.efficiencyPct > 100) issues.push("放电效率必须在 0~100% 之间。");
    if (input.activePowerMw < 0) issues.push("Active 功耗不能为负数。");
    if (input.wakeCountPerDay < 0) issues.push("唤醒次数不能为负数。");
    if (input.wakeDurationSec < 0) issues.push("单次录制时长不能为负数。");
    if (input.sleepPowerMw < 0) issues.push("休眠功耗不能为负数。");
    if (input.aorPowerMw < 0) issues.push("AOR 功耗不能为负数。");

    if (getAllowedModesByPlatform(input.hardwarePlatform).indexOf(input.mode) === -1) {
      issues.push("当前硬件平台不支持该模式。");
    }

    var activeHours = (input.wakeCountPerDay * input.wakeDurationSec) / 3600;
    if (activeHours > 24) {
      issues.push("活动总时长已超过 24 小时/天，请调整唤醒次数或单次录制时长。");
    } else if (activeHours > 12) {
      warnings.push("活动时长超过 12 小时/天，建议复核项目设定。");
    }

    return { issues: issues, warnings: warnings };
  }

  function calculatePower(rawInput, options) {
    var normalized = normalizeInput(rawInput || {}, options);
    var input = normalized.input;
    var validation = validateInput(input);

    var result = {
      totalEnergyWh: 0,
      dailyEnergyMwh: 0,
      avgPowerMw: 0,
      runtimeDays: 0,
      runtimeMonths: 0,
      displayRuntimeValue: 0,
      displayRuntimeUnit: "天",
      activeHoursPerDay: 0,
      idleHoursPerDay: 0,
      breakdown: { activeMwh: 0, sleepMwh: 0, aorMwh: 0 },
      warnings: validation.warnings.slice()
    };

    if (validation.issues.length > 0) {
      return {
        input: input,
        result: result,
        validation: {
          issues: validation.issues,
          warnings: validation.warnings,
          infos: normalized.adjustments.slice()
        }
      };
    }

    var eff = input.efficiencyPct / 100;
    var totalEnergyWh = (input.batteryMah * input.voltageV * eff) / 1000;
    var activeHours = (input.wakeCountPerDay * input.wakeDurationSec) / 3600;
    var idleHours = Math.max(0, 24 - activeHours);
    var activeMwh = input.activePowerMw * activeHours;
    var sleepIdleMwh = input.sleepPowerMw * idleHours;
    var aorIdleMwh = input.aorPowerMw * idleHours;
    var thresholdRatio = clamp(input.smartThresholdPct, 0, 100) / 100;
    var dailyEnergyMwh;
    var breakdown = { activeMwh: 0, sleepMwh: 0, aorMwh: 0 };

    if (input.mode === "always") {
      dailyEnergyMwh = input.activePowerMw * 24;
      breakdown.activeMwh = dailyEnergyMwh;
    } else if (input.mode === "sleep") {
      dailyEnergyMwh = activeMwh + sleepIdleMwh;
      breakdown.activeMwh = activeMwh;
      breakdown.sleepMwh = sleepIdleMwh;
    } else if (input.mode === "aor") {
      dailyEnergyMwh = activeMwh + aorIdleMwh;
      breakdown.activeMwh = activeMwh;
      breakdown.aorMwh = aorIdleMwh;
    } else {
      dailyEnergyMwh = activeMwh + (sleepIdleMwh * thresholdRatio) + (aorIdleMwh * (1 - thresholdRatio));
      breakdown.activeMwh = activeMwh;
      breakdown.sleepMwh = sleepIdleMwh * thresholdRatio;
      breakdown.aorMwh = aorIdleMwh * (1 - thresholdRatio);
    }

    if (dailyEnergyMwh <= 0) {
      result.warnings.push("每日能耗为 0，无法给出有效续航天数。");
      dailyEnergyMwh = 0;
    }

    var runtimeDays = dailyEnergyMwh > 0 ? (totalEnergyWh * 1000) / dailyEnergyMwh : 0;
    var displayRuntimeValue = runtimeDays;
    var displayRuntimeUnit = "天";
    if (runtimeDays > 0 && runtimeDays < 1) {
      displayRuntimeValue = runtimeDays * 24;
      displayRuntimeUnit = "小时";
    }

    result.totalEnergyWh = totalEnergyWh;
    result.dailyEnergyMwh = dailyEnergyMwh;
    result.avgPowerMw = dailyEnergyMwh / 24;
    result.runtimeDays = runtimeDays;
    result.runtimeMonths = runtimeDays / 30;
    result.displayRuntimeValue = displayRuntimeValue;
    result.displayRuntimeUnit = displayRuntimeUnit;
    result.activeHoursPerDay = activeHours;
    result.idleHoursPerDay = idleHours;
    result.breakdown = breakdown;

    return {
      input: input,
      result: result,
      validation: {
        issues: validation.issues,
        warnings: validation.warnings,
        infos: normalized.adjustments.slice()
      }
    };
  }

  function createProject(name, inputOverrides) {
    var raw = Object.assign(defaultInput(), inputOverrides || {});
    var computed = calculatePower(raw);
    return {
      id: uid(),
      name: name || ("项目 " + (state.projects.length + 1)),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      input: computed.input,
      result: computed.result,
      validation: computed.validation
    };
  }

  function getSelectedProject() {
    return state.projects.find(function (p) { return p.id === state.selectedProjectId; }) || null;
  }

  function guessWirelessTypeFromLegacyInput(input) {
    var sleepPower = safeNumber(input && input.sleepPowerMw, 6);
    return sleepPower <= 3 ? "wifi" : "4g";
  }

  function migrateLegacyScenarios() {
    try {
      var raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) return false;

      state.projects = parsed.scenarios.slice(0, MAX_PROJECTS).map(function (s, index) {
        var legacyInput = s.input || {};
        var migratedRaw = Object.assign({}, legacyInput, {
          wirelessType: guessWirelessTypeFromLegacyInput(legacyInput),
          hardwarePlatform: "6920"
        });
        var computed = calculatePower(migratedRaw, { silentAdjustments: true });
        return {
          id: s.id || uid(),
          name: typeof s.name === "string" ? s.name.replace(/场景/g, "项目") : ("项目 " + (index + 1)),
          createdAt: s.createdAt || nowIso(),
          updatedAt: s.updatedAt || nowIso(),
          input: computed.input,
          result: computed.result,
          validation: computed.validation
        };
      });

      state.selectedProjectId = parsed.selectedScenarioId || (state.projects[0] && state.projects[0].id);
      if (!getSelectedProject() && state.projects[0]) state.selectedProjectId = state.projects[0].id;
      saveState();
      return true;
    } catch (err) {
      return false;
    }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("empty");
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.projects) || parsed.projects.length === 0) throw new Error("bad");

      state.projects = parsed.projects.slice(0, MAX_PROJECTS).map(function (p, index) {
        var computed = calculatePower(p.input || {}, { silentAdjustments: true });
        return {
          id: p.id || uid(),
          name: typeof p.name === "string" ? p.name : ("项目 " + (index + 1)),
          createdAt: p.createdAt || nowIso(),
          updatedAt: p.updatedAt || nowIso(),
          input: computed.input,
          result: computed.result,
          validation: computed.validation
        };
      });
      state.selectedProjectId = parsed.selectedProjectId || state.projects[0].id;
      if (!getSelectedProject()) state.selectedProjectId = state.projects[0].id;
      return;
    } catch (err) {
      if (migrateLegacyScenarios()) return;
    }

    state.projects = [
      createProject("项目 1", { hardwarePlatform: "6920", wirelessType: "4g", mode: "smart", batteryMah: 5200 }),
      createProject("项目 2", { hardwarePlatform: "6921", wirelessType: "wifi", mode: "sleep", batteryMah: 9000 }),
      createProject("OV8000 项目", { hardwarePlatform: "OV8000", wirelessType: "wifi", mode: "always", batteryMah: 5200 })
    ];
    state.selectedProjectId = state.projects[0].id;
  }

  function saveState() {
    var payload = {
      selectedProjectId: state.selectedProjectId,
      projects: state.projects.map(function (p) {
        return {
          id: p.id,
          name: p.name,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          input: p.input
        };
      })
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function makeUniqueProjectName(baseName, excludeId) {
    var clean = (baseName || "未命名项目").trim() || "未命名项目";
    var names = state.projects
      .filter(function (p) { return p.id !== excludeId; })
      .map(function (p) { return p.name; });
    if (names.indexOf(clean) === -1) return clean;

    var index = 2;
    while (names.indexOf(clean + " (" + index + ")") !== -1) {
      index += 1;
    }
    return clean + " (" + index + ")";
  }

  function recalcProject(project, options) {
    var computed = calculatePower(project.input, options);
    project.input = computed.input;
    project.result = computed.result;
    project.validation = computed.validation;
  }

  function bindRefs() {
    refs.projectCountChip = document.getElementById("projectCountChip");
    refs.projectSelect = document.getElementById("projectSelect");
    refs.saveStatus = document.getElementById("saveStatus");
    refs.modeButtons = Array.prototype.slice.call(document.querySelectorAll(".mode-btn"));
    refs.form = document.getElementById("powerForm");
    refs.validationList = document.getElementById("validationList");
    refs.modeLimitHint = document.getElementById("modeLimitHint");

    refs.inputs = {
      projectName: document.getElementById("projectName"),
      batteryMah: document.getElementById("batteryMah"),
      wirelessType: document.getElementById("wirelessType"),
      hardwarePlatform: document.getElementById("hardwarePlatform"),
      voltageV: document.getElementById("voltageV"),
      efficiencyPct: document.getElementById("efficiencyPct"),
      activePowerMw: document.getElementById("activePowerMw"),
      wakeCountPerDay: document.getElementById("wakeCountPerDay"),
      wakeDurationSec: document.getElementById("wakeDurationSec"),
      sleepPowerMw: document.getElementById("sleepPowerMw"),
      aorPowerMw: document.getElementById("aorPowerMw"),
      smartThresholdPct: document.getElementById("smartThresholdPct"),
      smartThresholdPctOut: document.getElementById("smartThresholdPctOut")
    };

    refs.outputs = {
      runtimeValue: document.getElementById("runtimeValue"),
      runtimeUnit: document.getElementById("runtimeUnit"),
      runtimeMonths: document.getElementById("runtimeMonths"),
      avgPowerMw: document.getElementById("avgPowerMw"),
      dailyEnergyMwh: document.getElementById("dailyEnergyMwh"),
      activeHoursPerDay: document.getElementById("activeHoursPerDay"),
      lifeRing: document.getElementById("lifeRing")
    };

    refs.chartCanvas = document.getElementById("breakdownChart");
    refs.chartFallback = document.getElementById("chartFallback");
    refs.fieldWrappers = {
      sleepPowerMw: document.querySelector('[data-field="sleepPowerMw"]'),
      aorPowerMw: document.querySelector('[data-field="aorPowerMw"]'),
      smartThresholdPct: document.querySelector('[data-field="smartThresholdPct"]')
    };
  }

  function bindEvents() {
    document.getElementById("btnNewProject").addEventListener("click", onNewProject);
    document.getElementById("btnSaveProject").addEventListener("click", onSaveProject);
    document.getElementById("btnSaveAsProject").addEventListener("click", onSaveAsProject);
    document.getElementById("btnDeleteProject").addEventListener("click", onDeleteProject);
    document.getElementById("btnExportCsv").addEventListener("click", exportCsv);
    document.getElementById("btnPrint").addEventListener("click", function () { window.print(); });

    refs.projectSelect.addEventListener("change", function () {
      var nextId = refs.projectSelect.value;
      if (!nextId) return;
      state.selectedProjectId = nextId;
      render();
      setSaveStatus("已切换项目");
    });

    refs.modeButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var current = getSelectedProject();
        if (!current) return;
        current.input.mode = btn.dataset.mode;
        current.updatedAt = nowIso();
        recalcProject(current);
        persistAndRender("已自动保存");
      });
    });

    refs.form.addEventListener("input", onFormInput);
    refs.form.addEventListener("change", onFormInput);
  }

  function onNewProject() {
    if (state.projects.length >= MAX_PROJECTS) {
      alert("已达到项目数量上限（" + MAX_PROJECTS + "）。");
      return;
    }
    var baseName = "项目 " + (state.projects.length + 1);
    var project = createProject(makeUniqueProjectName(baseName));
    state.projects.push(project);
    state.selectedProjectId = project.id;
    persistAndRender("已创建新项目");
  }

  function onSaveProject() {
    var current = getSelectedProject();
    if (!current) return;
    current.name = makeUniqueProjectName(current.name || "未命名项目", current.id);
    current.updatedAt = nowIso();
    recalcProject(current);
    persistAndRender("项目已保存");
  }

  function onSaveAsProject() {
    var current = getSelectedProject();
    if (!current) return;
    if (state.projects.length >= MAX_PROJECTS) {
      alert("已达到项目数量上限（" + MAX_PROJECTS + "）。");
      return;
    }
    var clone = deepClone(current);
    clone.id = uid();
    clone.name = makeUniqueProjectName((current.name || "未命名项目") + " (副本)");
    clone.createdAt = nowIso();
    clone.updatedAt = nowIso();
    recalcProject(clone, { silentAdjustments: true });
    state.projects.push(clone);
    state.selectedProjectId = clone.id;
    persistAndRender("已另存为新项目");
  }

  function onDeleteProject() {
    var current = getSelectedProject();
    if (!current) return;
    var ok = window.confirm("确定删除当前项目“" + current.name + "”吗？");
    if (!ok) return;

    state.projects = state.projects.filter(function (p) { return p.id !== current.id; });
    if (state.projects.length === 0) {
      var fallback = createProject("项目 1");
      state.projects.push(fallback);
      state.selectedProjectId = fallback.id;
    } else {
      state.selectedProjectId = state.projects[0].id;
    }
    persistAndRender("项目已删除");
  }

  function onFormInput(e) {
    var current = getSelectedProject();
    if (!current) return;

    var target = e.target;
    var id = target.id;
    if (!id) return;

    if (id === "projectName") {
      current.name = target.value.trim() || "未命名项目";
    } else if (id === "wirelessType" || id === "hardwarePlatform" || id === "mode") {
      current.input[id] = target.value;
    } else if (id === "smartThresholdPct") {
      current.input.smartThresholdPct = safeNumber(target.value, 40);
    } else if (Object.prototype.hasOwnProperty.call(current.input, id)) {
      current.input[id] = safeNumber(target.value, current.input[id]);
    } else {
      return;
    }

    current.updatedAt = nowIso();
    recalcProject(current);
    persistAndRender("已自动保存");
  }

  function persistAndRender(statusText) {
    saveState();
    render();
    if (typeof statusText === "string") {
      setSaveStatus(statusText);
    }
  }

  function render() {
    var selectedId = state.selectedProjectId;
    state.projects.forEach(function (p) {
      if (p.id === selectedId) return;
      recalcProject(p, { silentAdjustments: true });
    });
    renderProjectSelector();
    renderForm();
    renderModeButtons();
    renderValidation();
    renderSummary();
    renderChart();
    saveState();
  }

  function renderProjectSelector() {
    var current = getSelectedProject();
    refs.projectCountChip.textContent = state.projects.length + " 个";
    refs.projectSelect.innerHTML = "";

    state.projects.forEach(function (project) {
      var option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      refs.projectSelect.appendChild(option);
    });

    if (current) refs.projectSelect.value = current.id;
  }

  function renderForm() {
    var current = getSelectedProject();
    if (!current) return;
    var input = current.input;

    refs.inputs.projectName.value = current.name || "";
    refs.inputs.batteryMah.value = input.batteryMah;
    refs.inputs.wirelessType.value = input.wirelessType;
    refs.inputs.hardwarePlatform.value = input.hardwarePlatform;
    refs.inputs.voltageV.value = input.voltageV;
    refs.inputs.efficiencyPct.value = input.efficiencyPct;
    refs.inputs.activePowerMw.value = input.activePowerMw;
    refs.inputs.wakeCountPerDay.value = input.wakeCountPerDay;
    refs.inputs.wakeDurationSec.value = input.wakeDurationSec;
    refs.inputs.sleepPowerMw.value = input.sleepPowerMw;
    refs.inputs.aorPowerMw.value = input.aorPowerMw;
    refs.inputs.smartThresholdPct.value = input.smartThresholdPct;
    refs.inputs.smartThresholdPctOut.textContent = input.smartThresholdPct + "%";

    var mode = input.mode;
    refs.fieldWrappers.sleepPowerMw.classList.toggle("field-hidden", !(mode === "sleep" || mode === "smart"));
    refs.fieldWrappers.aorPowerMw.classList.toggle("field-hidden", !(mode === "aor" || mode === "smart"));
    refs.fieldWrappers.smartThresholdPct.classList.toggle("field-hidden", mode !== "smart");
  }

  function renderModeButtons() {
    var current = getSelectedProject();
    if (!current) return;
    var allowed = getAllowedModesByPlatform(current.input.hardwarePlatform);

    refs.modeButtons.forEach(function (btn) {
      var mode = btn.dataset.mode;
      var disabled = allowed.indexOf(mode) === -1;
      var active = mode === current.input.mode;
      btn.disabled = disabled;
      btn.classList.toggle("is-disabled", disabled);
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = disabled ? -1 : (active ? 0 : -1);
      btn.title = disabled ? "当前硬件平台不支持该模式" : "";
    });

    if (current.input.hardwarePlatform === "OV8000") {
      refs.modeLimitHint.textContent = "OV8000 仅支持休眠唤醒/长电模式";
    } else {
      refs.modeLimitHint.textContent = "平台规则自动限制";
    }
  }

  function renderValidation() {
    var current = getSelectedProject();
    if (!current) return;
    var validation = current.validation || { issues: [], warnings: [], infos: [] };

    refs.validationList.innerHTML = "";

    (validation.infos || []).forEach(function (msg) {
      var li = document.createElement("li");
      li.className = "info";
      li.textContent = msg;
      refs.validationList.appendChild(li);
    });

    (validation.issues || []).forEach(function (msg) {
      var li = document.createElement("li");
      li.className = "error";
      li.textContent = msg;
      refs.validationList.appendChild(li);
    });

    (validation.warnings || []).forEach(function (msg) {
      var li = document.createElement("li");
      li.className = "warn";
      li.textContent = msg;
      refs.validationList.appendChild(li);
    });

    if ((validation.infos || []).length === 0 &&
        (validation.issues || []).length === 0 &&
        (validation.warnings || []).length === 0) {
      var ok = document.createElement("li");
      ok.className = "ok";
      ok.textContent = "输入通过校验，可用于项目评审。";
      refs.validationList.appendChild(ok);
    }
  }

  function renderSummary() {
    var current = getSelectedProject();
    if (!current) return;
    var r = current.result;

    refs.outputs.runtimeValue.textContent = round(r.displayRuntimeValue, 1).toFixed(1);
    refs.outputs.runtimeUnit.textContent = r.displayRuntimeUnit;
    refs.outputs.runtimeMonths.textContent = round(r.runtimeMonths, 1).toFixed(1);
    refs.outputs.avgPowerMw.textContent = round(r.avgPowerMw, 2).toFixed(2);
    refs.outputs.dailyEnergyMwh.textContent = round(r.dailyEnergyMwh, 0).toFixed(0);
    refs.outputs.activeHoursPerDay.textContent = round(r.activeHoursPerDay, 2).toFixed(2);

    refs.outputs.runtimeUnit.style.color = r.displayRuntimeUnit === "小时" ? "#fb923c" : "#cbd5e1";
    var ringRatio = clamp(r.runtimeDays / 365, 0.05, 1);
    var rotateDeg = -45 + Math.round(ringRatio * 300);
    refs.outputs.lifeRing.style.transform = "rotate(" + rotateDeg + "deg)";
    refs.outputs.lifeRing.style.opacity = String(clamp(0.35 + ringRatio * 0.7, 0.35, 1));
  }

  function renderChart() {
    var current = getSelectedProject();
    if (!current) return;
    var r = current.result;
    var values = [
      round(r.breakdown.activeMwh, 2),
      round(r.breakdown.sleepMwh, 2),
      round(r.breakdown.aorMwh, 2)
    ];

    if (!window.Chart) {
      refs.chartFallback.hidden = false;
      return;
    }
    refs.chartFallback.hidden = true;

    var config = {
      type: "bar",
      data: {
        labels: ["活动", "休眠", "AOR"],
        datasets: [{
          data: values,
          backgroundColor: ["#2563eb", "#059669", "#ea580c"],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) { return " " + ctx.raw + " mWh"; }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: function (v) { return v + " mWh"; } },
            grid: { color: "rgba(148,163,184,0.14)" }
          },
          x: { grid: { display: false } }
        }
      }
    };

    if (state.chart) {
      state.chart.data = config.data;
      state.chart.options = config.options;
      state.chart.update();
    } else {
      state.chart = new window.Chart(refs.chartCanvas.getContext("2d"), config);
    }
  }

  function exportCsv() {
    var header = [
      "项目名称", "硬件平台", "无线类型", "模式", "电池电量(mAh)", "电压(V)", "效率(%)",
      "Active功耗(mW)", "唤醒次数/天", "单次录制(s)", "休眠功耗(mW)", "AOR功耗(mW)",
      "智能阈值(%)", "续航(天)", "续航(月)", "平均功耗(mW)", "每日能耗(mWh)"
    ];

    var rows = state.projects.map(function (p) {
      return [
        p.name,
        PLATFORM_LABELS[p.input.hardwarePlatform] || p.input.hardwarePlatform,
        WIRELESS_LABELS[p.input.wirelessType] || p.input.wirelessType,
        MODE_LABELS[p.input.mode],
        p.input.batteryMah,
        p.input.voltageV,
        p.input.efficiencyPct,
        p.input.activePowerMw,
        p.input.wakeCountPerDay,
        p.input.wakeDurationSec,
        p.input.sleepPowerMw,
        p.input.aorPowerMw,
        p.input.smartThresholdPct,
        round(p.result.runtimeDays, 3),
        round(p.result.runtimeMonths, 3),
        round(p.result.avgPowerMw, 3),
        round(p.result.dailyEnergyMwh, 3)
      ];
    });

    var csv = [header].concat(rows).map(function (line) {
      return line.map(csvEscape).join(",");
    }).join("\n");

    var blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, "power_projects_" + dateStamp() + ".csv");
  }

  function csvEscape(value) {
    var s = String(value == null ? "" : value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function dateStamp() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    var hh = String(d.getHours()).padStart(2, "0");
    var mm = String(d.getMinutes()).padStart(2, "0");
    return "" + y + m + day + "_" + hh + mm;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function init() {
    bindRefs();
    loadState();
    bindEvents();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
