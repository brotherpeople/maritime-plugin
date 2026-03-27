const WHEEL_BASE_URL = 'https://raw.githubusercontent.com/brotherpeople/maritime-plugin/main/';

let state = {
  bezelId: null,
  outlineBezelId: null,
  groupId: null,
  wheelId: null,
  target: null,
};

figma.showUI(__html__, { width: 410, height: 280, title: 'Image Bezel Generator' });
figma.on('selectionchange', handleSelection);
handleSelection();

// ── Selection ─────────────────────────────────

async function handleSelection() {
  const node = figma.currentPage.selection[0];
  const validTypes = ['RECTANGLE', 'FRAME', 'COMPONENT', 'INSTANCE'];

  if (!node || !validTypes.includes(node.type)) {
    state.target = null;
    figma.ui.postMessage({ type: 'noSelection' });
    return;
  }

  state.target = node;

  const saved = node.getPluginData('bezelData');
  if (!saved) {
    clearState();
    await sendNoBezelInit();
    return;
  }

  const data = JSON.parse(saved);
  const bezelNode = await figma.getNodeByIdAsync(data.bezelId);

  if (bezelNode && bezelNode.parent === node.parent) {
    Object.assign(state, {
      bezelId: data.bezelId,
      outlineBezelId: data.outlineBezelId,
      groupId: data.groupId,
      wheelId: data.wheelId || null,
    });
    figma.ui.postMessage(Object.assign({ type: 'init', hasBezel: true }, data));
  } else {
    node.setPluginData('bezelData', '');
    node.setPluginData('originalRadius', '');
    clearState();
    await sendNoBezelInit();
  }
}

async function sendNoBezelInit() {
  const presets = await getPresets();
  figma.ui.postMessage({ type: 'init', strokeWeight: 4, cornerRadius: 8, hasBezel: false, presets });
}

function clearState() {
  state.bezelId = null;
  state.outlineBezelId = null;
  state.groupId = null;
  state.wheelId = null;
}

// ── Message handler ───────────────────────────

figma.ui.onmessage = async msg => {
  const handlers = {
    create:       () => createBezels(msg.strokeWeight, msg.cornerRadius),
    update:       () => updateBezels(msg.strokeWeight, msg.cornerRadius),
    delete:       () => deleteBezels(),
    wheelCreate:  () => createWheel(msg.wheelType, msg.wheelSize, msg.wheelX, msg.wheelY),
    wheelUpdate:  () => updateWheel(msg.wheelType, msg.wheelSize, msg.wheelX, msg.wheelY),
    wheelDelete:  () => deleteWheel(),
    shadowUpdate: () => updateShadow(msg.enabled, msg.opacity, msg.blur, msg.offsetX, msg.offsetY),
    resize:       () => figma.ui.resize(410, msg.height),
    presetSave:   () => savePreset(msg.name, msg.strokeWeight, msg.cornerRadius),
    presetDelete: () => deletePreset(msg.name),
    presetLoad:   async () => figma.ui.postMessage({ type: 'presetsLoaded', presets: await getPresets() }),
    presetApply:  () => applyPreset(msg.strokeWeight, msg.cornerRadius, msg.scaleMode, msg.refWidth, msg.refHeight),
  };

  const handler = handlers[msg.type];
  if (!handler) return;
  if (msg.type === 'create' && !state.target) {
    figma.notify('⚠️ Please select an image layer first.');
    return;
  }
  if (msg.type === 'update' && (!state.bezelId || !state.outlineBezelId)) return;
  await handler();
};

// ── Network ───────────────────────────────────

async function fetchWheelImage(type) {
  const res = await fetch(WHEEL_BASE_URL + type + '.png');
  const buf = await res.arrayBuffer();
  return figma.createImage(new Uint8Array(buf)).hash;
}

// ── Bezel ─────────────────────────────────────

async function disbandBezelGroup() {
  if (!state.groupId) return;
  const group = await figma.getNodeByIdAsync(state.groupId);
  if (!group || group.type !== 'GROUP') return;
  const parent = group.parent;
  const idx = parent.children.indexOf(group);
  for (const id of [state.bezelId, state.outlineBezelId]) {
    const n = id ? await figma.getNodeByIdAsync(id) : null;
    if (n) { try { n.locked = false; n.remove(); } catch(e) {} }
  }
  parent.insertChild(idx, state.target);
  try { group.remove(); } catch(e) {}
}

async function createBezels(strokeWeight, cornerRadius) {
  const { target } = state;

  if (!target.getPluginData('originalRadius')) {
    const original = typeof target.cornerRadius === 'number' ? target.cornerRadius : 0;
    target.setPluginData('originalRadius', String(original));
  }

  await disbandBezelGroup();

  const parent = target.parent;
  const idx = parent.children.indexOf(target);

  const bezel = figma.createRectangle();
  bezel.name = 'Bezel';
  bezel.x = target.x;
  bezel.y = target.y;
  bezel.resize(target.width, target.height);
  bezel.cornerRadius = cornerRadius;
  bezel.fills = [];
  bezel.strokes = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
  bezel.strokeWeight = strokeWeight;
  bezel.strokeAlign = 'OUTSIDE';

  const outline = figma.createRectangle();
  outline.name = 'Outline Bezel';
  outline.fills = [];
  outline.strokes = [{
    type: 'GRADIENT_LINEAR',
    gradientTransform: [[0, 1, 0], [-1, 0, 1]],
    gradientStops: [
      { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
      { position: 1, color: { r: 0.7, g: 0.7, b: 0.7, a: 1 } },
    ],
  }];
  outline.strokeWeight = 2;
  outline.strokeAlign = 'OUTSIDE';

  parent.insertChild(idx, bezel);
  parent.insertChild(idx, outline);
  positionOutline(outline, bezel, strokeWeight, cornerRadius);

  if (typeof target.cornerRadius === 'number' || target.cornerRadius === figma.mixed) {
    target.cornerRadius = cornerRadius;
  }

  const group = figma.group([outline, bezel, target], parent);
  group.name = 'Bezel Group';

  bezel.locked = true;
  outline.locked = true;

  state.bezelId = bezel.id;
  state.outlineBezelId = outline.id;
  state.groupId = group.id;

  savePluginData({ strokeWeight, cornerRadius });
  figma.ui.postMessage({ type: 'bezelCreated' });
  figma.notify('✅ Bezel created!');
}

async function updateBezels(strokeWeight, cornerRadius) {
  const bezel = await figma.getNodeByIdAsync(state.bezelId);
  const outline = await figma.getNodeByIdAsync(state.outlineBezelId);

  if (!bezel || !outline) {
    figma.notify('⚠️ Bezel not found. Press Create again.');
    state.bezelId = null; state.outlineBezelId = null; state.groupId = null;
    state.target.setPluginData('bezelData', '');
    figma.ui.postMessage({ type: 'bezelLost' });
    return;
  }

  bezel.locked = false;
  outline.locked = false;
  bezel.strokeWeight = strokeWeight;
  bezel.cornerRadius = cornerRadius;

  if (typeof state.target.cornerRadius === 'number' || state.target.cornerRadius === figma.mixed) {
    state.target.cornerRadius = cornerRadius;
  }

  positionOutline(outline, bezel, strokeWeight, cornerRadius);
  bezel.locked = true;
  outline.locked = true;

  savePluginData({ strokeWeight, cornerRadius });
}

async function deleteBezels() {
  const { target } = state;
  if (state.wheelId) await deleteWheel();
  updateShadow(false, 50, 10, 0, 8);

  const originalRadius = parseFloat(target.getPluginData('originalRadius') || '0');
  if (typeof target.cornerRadius === 'number' || target.cornerRadius === figma.mixed) {
    target.cornerRadius = originalRadius;
  }

  await disbandBezelGroup();

  target.setPluginData('bezelData', '');
  target.setPluginData('originalRadius', '');
  clearState();
  figma.notify('🗑️ Bezel deleted.');
}

// ── Shadow ────────────────────────────────────

function updateShadow(enabled, opacity, blur, offsetX, offsetY) {
  if (!state.target) return;

  state.target.effects = enabled ? [{
    type: 'DROP_SHADOW',
    color: { r: 0, g: 0, b: 0, a: opacity / 100 },
    offset: { x: offsetX, y: offsetY },
    radius: blur,
    spread: 0,
    visible: true,
    blendMode: 'NORMAL',
  }] : [];

  savePluginData(enabled
    ? { shadowEnabled: true, shadowOpacity: opacity, shadowBlur: blur, shadowX: offsetX, shadowY: offsetY }
    : { shadowEnabled: false }
  );
}

// ── Steering Wheel ────────────────────────────

async function createWheel(wheelType, wheelSize, offsetX, offsetY) {
  if (state.wheelId) await deleteWheel();

  const group = await figma.getNodeByIdAsync(state.groupId);
  if (!group) { figma.notify('⚠️ Bezel group not found.'); return; }

  figma.notify('⏳ Loading wheel image...');
  const hash = await fetchWheelImage(wheelType);
  const { target } = state;

  const wheel = figma.createRectangle();
  wheel.name = 'Steering Wheel (' + wheelType + ')';
  wheel.resize(wheelSize, wheelSize);
  wheel.x = target.x + (target.width - wheelSize) / 2 + offsetX;
  wheel.y = target.y + (target.height - wheelSize) / 2 + offsetY;
  wheel.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: hash }];
  wheel.locked = true;

  group.appendChild(wheel);
  state.wheelId = wheel.id;

  savePluginData({ wheelType, wheelSize, wheelX: offsetX, wheelY: offsetY });
  figma.notify('✅ Steering wheel added!');
}

async function updateWheel(wheelType, wheelSize, offsetX, offsetY) {
  if (!state.wheelId) { await createWheel(wheelType, wheelSize, offsetX, offsetY); return; }

  const wheel = await figma.getNodeByIdAsync(state.wheelId);
  if (!wheel) { await createWheel(wheelType, wheelSize, offsetX, offsetY); return; }

  const { target } = state;
  wheel.locked = false;
  wheel.resize(wheelSize, wheelSize);
  wheel.x = target.x + (target.width - wheelSize) / 2 + offsetX;
  wheel.y = target.y + (target.height - wheelSize) / 2 + offsetY;
  wheel.name = 'Steering Wheel (' + wheelType + ')';
  wheel.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: await fetchWheelImage(wheelType) }];
  wheel.locked = true;

  savePluginData({ wheelType, wheelSize, wheelX: offsetX, wheelY: offsetY });
}

async function deleteWheel() {
  if (!state.wheelId) return;
  const wheel = await figma.getNodeByIdAsync(state.wheelId);
  if (wheel) { try { wheel.locked = false; wheel.remove(); } catch(e) {} }
  state.wheelId = null;
  savePluginData({ wheelEnabled: false, wheelId: null });
}

// ── Preset ────────────────────────────────────

async function getPresets() {
  return (await figma.clientStorage.getAsync('bezelPresets')) || [];
}

async function savePreset(name, strokeWeight, cornerRadius) {
  const presets = await getPresets();
  const refWidth = (state.target && state.target.width) || 100;
  const refHeight = (state.target && state.target.height) || 100;
  const idx = presets.findIndex(p => p.name === name);
  const entry = { name, strokeWeight, cornerRadius, refWidth, refHeight };

  if (idx >= 0) presets[idx] = entry;
  else presets.push(entry);

  await figma.clientStorage.setAsync('bezelPresets', presets);
  figma.ui.postMessage({ type: 'presetsLoaded', presets });
  figma.notify('✅ Preset "' + name + '" saved!');
}

async function deletePreset(name) {
  const presets = (await getPresets()).filter(p => p.name !== name);
  await figma.clientStorage.setAsync('bezelPresets', presets);
  figma.ui.postMessage({ type: 'presetsLoaded', presets });
  figma.notify('🗑️ Preset "' + name + '" deleted.');
}

function applyPreset(strokeWeight, cornerRadius, scaleMode, refWidth, refHeight) {
  let sw = strokeWeight, cr = cornerRadius;

  if (scaleMode === 'scale' && state.target && refWidth && refHeight) {
    const factor = Math.min(state.target.width, state.target.height) / Math.min(refWidth, refHeight);
    sw = Math.min(Math.max(Math.round(strokeWeight * factor), 1), 100);
    cr = Math.min(Math.max(Math.round(cornerRadius * factor), 0), 300);
  }

  figma.ui.postMessage({ type: 'presetApplied', strokeWeight: sw, cornerRadius: cr });
}

// ── Helpers ───────────────────────────────────

function positionOutline(outline, bezel, strokeWeight, cornerRadius) {
  const o = strokeWeight;
  outline.x = bezel.x - o;
  outline.y = bezel.y - o;
  outline.resize(bezel.width + o * 2, bezel.height + o * 2);
  outline.cornerRadius = cornerRadius > 0 ? cornerRadius + o : 0;
}

function savePluginData(overrides) {
  const prev = JSON.parse(state.target.getPluginData('bezelData') || '{}');
  const data = Object.assign({
    bezelId: state.bezelId,
    outlineBezelId: state.outlineBezelId,
    groupId: state.groupId,
    wheelId: state.wheelId,
    strokeWeight: 4,
    cornerRadius: 8,
    wheelType: 'black',
    wheelSize: 300,
    wheelX: 0,
    wheelY: 0,
    wheelEnabled: !!state.wheelId,
    shadowEnabled: false,
    shadowOpacity: 50,
    shadowBlur: 10,
    shadowX: 0,
    shadowY: 8,
  }, prev, overrides);
  state.target.setPluginData('bezelData', JSON.stringify(data));
}
