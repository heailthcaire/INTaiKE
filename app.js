// File: app.js
// ED / ER Kiosk Intake Demo
// Loads forms_definition.json to build dynamic form sections.

(async function() {
  const selectorEl = document.getElementById('formSelector');
  const fieldsContainer = document.getElementById('fieldsContainer');
  const formEl = document.getElementById('dynamicForm');
  const previewSection = document.getElementById('previewSection');
  const jsonPreview = document.getElementById('jsonPreview');
  const tablePreview = document.getElementById('tablePreview');
  const toggleViewBtn = document.getElementById('toggleView');
  const copyJsonBtn = document.getElementById('copyJsonBtn');
  const downloadJsonBtn = document.getElementById('downloadJsonBtn');
  const resetSectionBtn = document.getElementById('resetSection');
  const clearAllFormsBtn = document.getElementById('clearAllForms');

  let FORMS_DEF = null;
  const formState = {};   // { formId: { fieldId: value } }
  let currentFormId = null;
  let currentJSON = null;
  let signaturePads = {}; // fieldId -> {canvas, ctx, drawing}

  // Fetch definitions
  async function loadDefinitions() {
    const res = await fetch('forms_definition.json');
    if (!res.ok) throw new Error('Unable to load forms_definition.json');
    return res.json();
  }

  function buildSelector() {
    selectorEl.innerHTML = '';
    FORMS_DEF.forms.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      selectorEl.appendChild(opt);
    });
  }

  function getFormDef(formId) {
    return FORMS_DEF.forms.find(f => f.id === formId);
  }

  function ensureFormState(formId) {
    if (!formState[formId]) formState[formId] = {};
    return formState[formId];
  }

  function renderForm(formId) {
    currentFormId = formId;
    const def = getFormDef(formId);
    const state = ensureFormState(formId);
    fieldsContainer.innerHTML = '';
    signaturePads = {};

    def.fields.forEach(field => {
      const wrap = document.createElement('div');
      wrap.className = 'form-field';
      if (field.fullWidth) wrap.classList.add('field-group-wide');
      wrap.dataset.fieldId = field.id;
      if (field.showIf) wrap.dataset.showIf = field.showIf;

      const label = document.createElement('label');
      label.setAttribute('for', field.id);
      label.innerHTML = `${field.label}${field.required ? ' <span class="req">*</span>' : ''}`;
      wrap.appendChild(label);

      let inputEl = null;
      const commonAttrs = (el) => {
        el.id = field.id;
        el.name = field.id;
        if (field.required) el.dataset.required = 'true';
        if (field.readonly) el.readOnly = true;
        if (field.placeholder) el.placeholder = field.placeholder;
        if (field.hint) {
          el.setAttribute('aria-describedby', `${field.id}-hint`);
        }
      };

      switch (field.type) {
        case 'text':
        case 'email':
        case 'tel':
        case 'date':
        case 'datetime':
        case 'number':
          inputEl = document.createElement('input');
          inputEl.type = (field.type === 'datetime') ? 'datetime-local' : field.type;
          commonAttrs(inputEl);
          break;
        case 'textarea':
          inputEl = document.createElement('textarea');
          commonAttrs(inputEl);
          if (field.rows) inputEl.rows = field.rows;
          break;
        case 'enum':
          inputEl = document.createElement('select');
          commonAttrs(inputEl);
            {
              const placeholderOpt = document.createElement('option');
              placeholderOpt.value = '';
              placeholderOpt.textContent = field.placeholder || 'Select...';
              inputEl.appendChild(placeholderOpt);
            }
          (field.options || []).forEach(o => {
            const opt = document.createElement('option');
            if (typeof o === 'string') {
              opt.value = o; opt.textContent = o;
            } else {
              opt.value = o.value;
              opt.textContent = o.label;
            }
            inputEl.appendChild(opt);
          });
          break;
        case 'multiselect':
          inputEl = document.createElement('select');
          inputEl.multiple = true;
          commonAttrs(inputEl);
          (field.options || []).forEach(o => {
            const opt = document.createElement('option');
            opt.value = (typeof o === 'string') ? o : o.value;
            opt.textContent = (typeof o === 'string') ? o : o.label;
            inputEl.appendChild(opt);
          });
          break;
        case 'boolean':
          inputEl = document.createElement('div');
          inputEl.className = 'checkbox-row';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.id = field.id;
          cb.name = field.id;
          if (field.required) cb.dataset.required = 'true';
          const span = document.createElement('span');
          span.textContent = field.inlineLabel || field.label;
          inputEl.appendChild(cb);
          inputEl.appendChild(span);
          break;
        case 'fileImage':
          inputEl = document.createElement('input');
          inputEl.type = 'file';
          inputEl.accept = 'image/*';
          commonAttrs(inputEl);
          break;
        case 'signature':
          inputEl = document.createElement('div');
          inputEl.className = 'signature-pad';
          const canvas = document.createElement('canvas');
          inputEl.appendChild(canvas);
          const tools = document.createElement('div');
          tools.className = 'signature-tools';
          const clearBtn = document.createElement('button');
          clearBtn.type = 'button';
          clearBtn.className = 'ghost-btn small';
          clearBtn.textContent = 'Clear';
          tools.appendChild(clearBtn);
          wrap.appendChild(inputEl);
          wrap.appendChild(tools);
          // Setup signature pad
          setupSignature(field.id, canvas, clearBtn);
          break;

        // NEW: Handle repeatable_group
        case 'repeatable_group':
          inputEl = document.createElement('div');
          inputEl.className = 'repeatable-group';
          inputEl.id = field.id;
          wrap.appendChild(inputEl);

          // Add + button
          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.textContent = '+ Add Entry';
          addBtn.className = 'add-entry-btn';
          addBtn.addEventListener('click', () => addRepeatableEntry(field.id));
          wrap.appendChild(addBtn);

          // Render existing entries
          renderRepeatableEntries(field, state[field.id] || []);
          break;
          
        default:
          inputEl = document.createElement('input');
          inputEl.type = 'text';
          commonAttrs(inputEl);
          break;
      }

      if (field.type !== 'signature' && field.type !== 'repeatable_group') {
        wrap.appendChild(inputEl);
      }

      if (field.hint) {
        const hint = document.createElement('div');
        hint.id = `${field.id}-hint`;
        hint.className = 'hint';
        hint.textContent = field.hint;
        wrap.appendChild(hint);
      }

      fieldsContainer.appendChild(wrap);

     // Pre-fill value if exists (for non-repeatable)
      if (state[field.id] !== undefined && field.type !== 'repeatable_group') {
        setFieldValue(field, state[field.id]);
      }
    });

    // Evaluate visibility after rendering
    updateConditionalVisibility();

    // Attach change listeners
    fieldsContainer.addEventListener('input', onFieldChange, { once: true });
    fieldsContainer.addEventListener('change', onFieldChange, { once: true });

    function onFieldChange() {
      fieldsContainer.addEventListener('input', handleDynamicChanges);
      fieldsContainer.addEventListener('change', handleDynamicChanges);
    }
  }

    // NEW: Function to render entries for a repeatable group
  function renderRepeatableEntries(field, entries) {
    const groupContainer = document.getElementById(field.id);
    groupContainer.innerHTML = ''; // Clear existing

    entries.forEach((entry, index) => {
      const entryWrap = document.createElement('div');
      entryWrap.className = 'repeatable-entry';
      entryWrap.dataset.index = index;

      field.subfields.forEach(subfield => {
        const subWrap = document.createElement('div');
        subWrap.className = 'subfield';

        const subLabel = document.createElement('label');
        subLabel.textContent = subfield.label;
        subWrap.appendChild(subLabel);

        let subInput = null;
        switch (subfield.type) {
          case 'text':
          case 'number':
          case 'date':
            subInput = document.createElement('input');
            subInput.type = subfield.type;
            subInput.name = `${field.id}_${index}_${subfield.id}`;
            subInput.value = entry[subfield.id] || '';
            if (subfield.required) subInput.required = true;
            break;
          // Add other subfield types as needed
        }

        if (subInput) {
          subWrap.appendChild(subInput);
        }

        entryWrap.appendChild(subWrap);
      });

      // Add - button
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '- Remove';
      removeBtn.className = 'remove-entry-btn';
      removeBtn.addEventListener('click', () => removeRepeatableEntry(field.id, index));
      entryWrap.appendChild(removeBtn);

      groupContainer.appendChild(entryWrap);
    });
  }

  // NEW: Add a new entry to a repeatable group
  function addRepeatableEntry(groupId) {
    const state = ensureFormState(currentFormId);
    if (!state[groupId]) state[groupId] = [];
    const newEntry = {};
    const field = getFieldDef(currentFormId, groupId);
    field.subfields.forEach(sub => newEntry[sub.id] = '');
    state[groupId].push(newEntry);
    renderRepeatableEntries(field, state[groupId]);
    updateConditionalVisibility();
  }

  // NEW: Remove an entry from a repeatable group
  function removeRepeatableEntry(groupId, index) {
    const state = ensureFormState(currentFormId);
    if (state[groupId] && state[groupId][index]) {
      state[groupId].splice(index, 1);
      const field = getFieldDef(currentFormId, groupId);
      renderRepeatableEntries(field, state[groupId]);
      updateConditionalVisibility();
    }
  }

  function setupSignature(fieldId, canvas, clearBtn) {
    const ctx = canvas.getContext('2d');
    const pad = { canvas, ctx, drawing: false, points: [] };
    signaturePads[fieldId] = pad;

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      redraw();
    }

    function pointerDown(e) {
      pad.drawing = true;
      pad.points.push([]);
      addPoint(e);
    }

    function pointerMove(e) {
      if (!pad.drawing) return;
      addPoint(e);
      redraw();
    }

    function pointerUp() {
      pad.drawing = false;
      saveSignature(fieldId);
    }

    function addPoint(e) {
      const rect = canvas.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      pad.points[pad.points.length - 1].push({ x, y });
    }

    function redraw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#4f9dff';
      pad.points.forEach(stroke => {
        if (!stroke.length) return;
        ctx.beginPath();
        ctx.moveTo(stroke[0].x, stroke[0].y);
        for (let i=1;i<stroke.length;i++){
          ctx.lineTo(stroke[i].x, stroke[i].y);
        }
        ctx.stroke();
      });
    }

    function clear() {
      pad.points = [];
      redraw();
      const state = ensureFormState(currentFormId);
      state[fieldId] = '';
      saveSignature(fieldId);
    }

    function saveSignature(fieldId) {
      const state = ensureFormState(currentFormId);
      if (pad.points.length) {
        state[fieldId] = canvas.toDataURL('image/png');
      } else {
        state[fieldId] = '';
      }
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    canvas.addEventListener('mousedown', pointerDown);
    canvas.addEventListener('mousemove', pointerMove);
    window.addEventListener('mouseup', pointerUp);
    canvas.addEventListener('touchstart', pointerDown);
    canvas.addEventListener('touchmove', pointerMove);
    window.addEventListener('touchend', pointerUp);
    clearBtn.addEventListener('click', clear);
  }

  function handleDynamicChanges(e) {
    const fieldId = e.target.name || e.target.id;
    if (!fieldId) return;
    storeFieldValue(fieldId);
    updateConditionalVisibility();
  }

  // UPDATED: Handle storing values for repeatable groups
  function storeFieldValue(fieldId) {
    const state = ensureFormState(currentFormId);
    const fieldDef = getFieldDef(currentFormId, fieldId);
    if (!fieldDef) return;

    if (fieldDef.type === 'repeatable_group') {
      // Collect all subfield values into array of objects
      const groupContainer = document.getElementById(fieldId);
      const entries = [];
      groupContainer.querySelectorAll('.repeatable-entry').forEach(entryWrap => {
        const index = entryWrap.dataset.index;
        const entry = {};
        fieldDef.subfields.forEach(sub => {
          const subEl = document.querySelector(`[name="${fieldId}_${index}_${sub.id}"]`);
          entry[sub.id] = subEl ? subEl.value : '';
        });
        entries.push(entry);
      });
      state[fieldId] = entries;
    } else if (fieldDef.type === 'boolean') {
      state[fieldId] = getBooleanValue(fieldId);
    } else if (fieldDef.type === 'multiselect') {
      const el = document.getElementById(fieldId);
      state[fieldId] = Array.from(el.selectedOptions).map(o => o.value);
    } else if (fieldDef.type === 'fileImage') {
      const el = document.getElementById(fieldId);
      if (el.files && el.files[0]) {
        state[fieldId] = {
          name: el.files[0].name,
          size: el.files[0].size,
          type: el.files[0].type
        };
      } else {
        state[fieldId] = null;
      }
    } else if (fieldDef.type === 'signature') {
      // signature handled separately
    } else {
      const el = document.getElementById(fieldId);
      state[fieldId] = el ? el.value : '';
    }
  }


  function getFieldDef(formId, fieldId) {
    const def = getFormDef(formId);
    return def.fields.find(f => f.id === fieldId);
  }

  // UPDATED: Set values for repeatable groups
  function setFieldValue(field, value) {
    if (field.type === 'repeatable_group') {
      const state = ensureFormState(currentFormId);
      state[field.id] = value || [];
      renderRepeatableEntries(field, state[field.id]);
    } else if (field.type === 'boolean') {
      const cb = document.querySelector(`[name="${field.id}"]`);
      if (cb) cb.checked = !!value;
    } else if (field.type === 'multiselect') {
      const sel = document.getElementById(field.id);
      if (sel && Array.isArray(value)) {
        Array.from(sel.options).forEach(opt => {
          opt.selected = value.includes(opt.value);
        });
      }
    } else if (field.type === 'fileImage') {
      // cannot prefill file inputs; ignore
    } else if (field.type === 'signature') {
      // after render we could re-draw from dataURL, omitted for brevity
    } else {
      const el = document.getElementById(field.id);
      if (el && value !== undefined) el.value = value;
    }
  }

  function getBooleanValue(fieldId) {
    const el = document.querySelector(`[name="${fieldId}"]`);
    return el ? !!el.checked : false;
  }

  function updateConditionalVisibility() {
    const def = getFormDef(currentFormId);
    if (!def) return;
    const state = ensureFormState(currentFormId);

    const context = { ...state };
    // helper derived fields
    if (state.birthDate) {
      const age = calcAge(state.birthDate);
      context.age = age;
    }

    function safeEval(expr) {
      try {
        const fn = new Function('state', 'with(state){ return !!(' + expr + ')}');
        return fn(context);
      } catch (e) {
        console.warn('Condition error:', expr, e);
        return false;
      }
    }

    def.fields.forEach(field => {
      if (!field.showIf) return;
      const wrap = fieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
      if (!wrap) return;
      const visible = safeEval(field.showIf);
      wrap.classList.toggle('hidden', !visible);
    });
  }

  function calcAge(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    const diff = Date.now() - d.getTime();
    const ageDate = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  }

  // UPDATED: Validate repeatable groups (e.g., check subfields if group is required)
  function validateForm() {
    const def = getFormDef(currentFormId);
    const missing = [];
    def.fields.forEach(field => {
      const wrap = fieldsContainer.querySelector(`[data-field-id="${field.id}"]`);
      if (wrap && wrap.classList.contains('hidden')) return; // ignore hidden
      let val = ensureFormState(currentFormId)[field.id];
      if (field.required) {
        if (field.type === 'boolean') {
          val = getBooleanValue(field.id);
          if (val === false && field.mustBeTrue) {
            missing.push(field.label + ' (must be accepted)');
          }
        } else if (field.type === 'multiselect' || field.type === 'repeatable_group') {
          if (!val || !val.length) missing.push(field.label);
        } else if (field.type === 'signature') {
          if (!val) missing.push(field.label);
        } else {
          if (val === undefined || val === null || val === '') {
            missing.push(field.label);
          }
        }
      }

      // NEW: Validate subfields in repeatable groups
      if (field.type === 'repeatable_group') {
        (val || []).forEach((entry, index) => {
          field.subfields.forEach(sub => {
            if (sub.required && (!entry[sub.id] || entry[sub.id] === '')) {
              missing.push(`${field.label} Entry ${index + 1}: ${sub.label}`);
            }
          });
        });
      }
    });

    // Clear previous errors
    fieldsContainer.querySelectorAll('.validation-error').forEach(el => {
      el.classList.remove('validation-error');
    });
    fieldsContainer.querySelectorAll('.inline-error').forEach(el => el.remove());

    if (missing.length) {
      // highlight fields (including subfields)
      def.fields.forEach(field => {
        if (field.type === 'repeatable_group') {
          // Highlight specific subfields if needed (simplified for brevity)
        } else if (missing.includes(field.label)) {
          const el = document.getElementById(field.id);
          if (el) {
            el.classList.add('validation-error');
            const err = document.createElement('div');
            err.className = 'inline-error';
            err.textContent = 'Required';
            if (!el.parentElement.querySelector('.inline-error')) {
              el.parentElement.appendChild(err);
            }
          }
        }
      });
      alert('Please complete required fields:\n - ' + missing.join('\n - '));
      return false;
    }

    return true;
  }

  function buildSubmissionJSON() {
    const dataCopy = structuredClone(formState[currentFormId] || {});
    return {
      formId: currentFormId,
      formName: getFormDef(currentFormId).name,
      timestamp: new Date().toISOString(),
      data: dataCopy
    };
  }

  function showPreview(obj) {
    currentJSON = obj;
    previewSection.classList.remove('hidden');
    jsonPreview.textContent = JSON.stringify(obj, null, 2);
    buildTablePreview(obj.data);
    tablePreview.classList.add('hidden');
    jsonPreview.classList.remove('hidden');
    toggleViewBtn.textContent = 'Show Table View';
  }

  function buildTablePreview(data) {
    const entries = Object.entries(data);
    if (!entries.length) {
      tablePreview.innerHTML = '<p>No data.</p>';
      return;
    }
    let html = '<table><thead><tr><th>Field ID</th><th>Value</th></tr></thead><tbody>';
    for (const [k,v] of entries) {
      html += `<tr><td>${escapeHTML(k)}</td><td>${escapeHTML(formatValue(v))}</td></tr>`;
    }
    html += '</tbody></table>';
    tablePreview.innerHTML = html;
  }

  // UPDATED: Handle repeatable groups in preview
  function formatValue(v) {
    if (Array.isArray(v)) {
      return v.map(item => JSON.stringify(item)).join(', ');
    }
    if (typeof v === 'object' && v !== null) {
      if (v.name && v.size) {
        return `${v.name} (${v.size} bytes)`;
      }
      const str = JSON.stringify(v);
      if (str.length > 120) return str.slice(0,120) + '...';
      return str;
    }
    if (typeof v === 'string' && v.startsWith('data:image/png')) {
      return '[signature image data URL]';
    }
    return String(v);
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // Event handlers
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    // Store all current field values
    const def = getFormDef(currentFormId);
    def.fields.forEach(f => {
      if (f.type === 'signature') {
        // signature already stored
        return;
      }
      storeFieldValue(f.id);
    });

    if (!validateForm()) return;
    const payload = buildSubmissionJSON();
    showPreview(payload);
    jsonPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  toggleViewBtn.addEventListener('click', () => {
    if (!currentJSON) return;
    const showingJSON = !jsonPreview.classList.contains('hidden');
    if (showingJSON) {
      jsonPreview.classList.add('hidden');
      tablePreview.classList.remove('hidden');
      toggleViewBtn.textContent = 'Show JSON View';
    } else {
      tablePreview.classList.add('hidden');
      jsonPreview.classList.remove('hidden');
      toggleViewBtn.textContent = 'Show Table View';
    }
  });

  copyJsonBtn.addEventListener('click', async () => {
    if (!currentJSON) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(currentJSON, null, 2));
      copyJsonBtn.textContent = 'Copied!';
      setTimeout(()=> copyJsonBtn.textContent = 'Copy JSON', 1500);
    } catch (e) {
      alert('Copy failed.');
    }
  });

  downloadJsonBtn.addEventListener('click', () => {
    if (!currentJSON) return;
    const blob = new Blob([JSON.stringify(currentJSON, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `${currentJSON.formId}-submission.json`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  });

  selectorEl.addEventListener('change', () => {
    renderForm(selectorEl.value);
    previewSection.classList.add('hidden');
  });

  resetSectionBtn.addEventListener('click', () => {
    if (!currentFormId) return;
    if (!confirm('Reset current section data?')) return;
    formState[currentFormId] = {};
    renderForm(currentFormId);
    previewSection.classList.add('hidden');
  });

  clearAllFormsBtn.addEventListener('click', () => {
    if (!confirm('Clear ALL stored form data for every section?')) return;
    for (const k of Object.keys(formState)) delete formState[k];
    if (currentFormId) renderForm(currentFormId);
    previewSection.classList.add('hidden');
  });

  // Initialization
  try {
    FORMS_DEF = await loadDefinitions();
    buildSelector();
    const firstId = FORMS_DEF.forms[0].id;
    selectorEl.value = firstId;
    renderForm(firstId);
  } catch (e) {
    console.error(e);
    fieldsContainer.innerHTML = '<p style="color:#e54848">Failed to load form definitions.</p>';
  }
})();
