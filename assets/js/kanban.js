/* ─────────────────────────────────────────────
   Kanban Prompt Builder — Vanilla JS
   ───────────────────────────────────────────── */
(function () {
    'use strict';

    /* ── Globals from wp_localize_script ── */
    const REST    = kpbData.restUrl;
    const NONCE   = kpbData.nonce;
    const BOARD   = parseInt(kpbData.boardId, 10);
    const CAN_EDIT = kpbData.canEdit === true || kpbData.canEdit === 'true' || kpbData.canEdit === '1';

    const app = document.getElementById('kpb-app');
    if (!app) return;

    /* ── State ── */
    let board      = null;   // { id, name, columns_json: [{id,name}] }
    let cards      = [];     // flat array from API
    let prompt     = [];     // ordered array of { cardId, text }
    let addedIds   = new Set();

    /* ── Helpers ── */
    function api(path, opts = {}) {
        const url = REST + path;
        const headers = { 'X-WP-Nonce': NONCE };
        if (opts.body && !(opts.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.body);
        }
        return fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) }, credentials: 'same-origin' })
            .then(r => {
                if (!r.ok) throw new Error(r.statusText);
                return r.json();
            });
    }

    function el(tag, attrs, ...children) {
        const e = document.createElement(tag);
        if (attrs) {
            for (const [k, v] of Object.entries(attrs)) {
                if (k === 'className') e.className = v;
                else if (k === 'dataset') Object.assign(e.dataset, v);
                else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
                else e.setAttribute(k, v);
            }
        }
        for (const c of children) {
            if (typeof c === 'string') e.appendChild(document.createTextNode(c));
            else if (c) e.appendChild(c);
        }
        return e;
    }

    function cardsForColumn(colId) {
        return cards.filter(c => c.column_id === colId).sort((a, b) => a.sort_order - b.sort_order);
    }

    /* ── Render ── */
    function render() {
        app.innerHTML = '';
        app.appendChild(renderBoard());
        app.appendChild(renderPanel());
    }

    /* ── Board ── */
    function renderBoard() {
        const boardEl = el('div', { className: 'kpb-board' });

        (board.columns_json || []).forEach((col, idx) => {
            boardEl.appendChild(renderColumn(col, idx));
        });

        if (CAN_EDIT) {
            const addCol = el('div', { className: 'kpb-add-column-btn', onClick: addColumn }, '+ Add Column');
            boardEl.appendChild(addCol);
        }

        return boardEl;
    }

    /* ── Column ── */
    function renderColumn(col, index) {
        const colCards = cardsForColumn(col.id);

        const header = el('div', { className: 'kpb-column-header' });

        const nameSpan = el('span', { className: 'kpb-column-name' }, col.name);
        header.appendChild(nameSpan);

        header.appendChild(el('span', { className: 'kpb-column-count' }, String(colCards.length)));

        if (CAN_EDIT) {
            header.appendChild(el('button', { className: 'kpb-col-btn edit', title: 'Rename', onClick: (e) => { e.stopPropagation(); renameColumn(col); } }, '✏️'));
            header.appendChild(el('button', { className: 'kpb-col-btn delete', title: 'Delete column', onClick: (e) => { e.stopPropagation(); deleteColumn(col); } }, '✕'));
        }

        // Column drag (reorder)
        if (CAN_EDIT) {
            header.setAttribute('draggable', 'true');
            header.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('kpb/column-index', String(index));
                e.dataTransfer.effectAllowed = 'move';
            });
        }

        const cardsContainer = el('div', { className: 'kpb-cards', dataset: { columnId: col.id } });

        colCards.forEach(card => {
            cardsContainer.appendChild(renderCard(card));
        });

        // Card drop zone
        cardsContainer.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('kpb/card-id')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            }
        });
        cardsContainer.addEventListener('drop', (e) => {
            const cardId = e.dataTransfer.getData('kpb/card-id');
            if (!cardId) return;
            e.preventDefault();
            const targetCol = col.id;

            // Determine drop position
            const cardEls = [...cardsContainer.querySelectorAll('.kpb-card')];
            let sortOrder = 0;
            for (const ce of cardEls) {
                const rect = ce.getBoundingClientRect();
                if (e.clientY < rect.top + rect.height / 2) break;
                sortOrder++;
            }

            moveCard(parseInt(cardId, 10), targetCol, sortOrder);
        });

        const colEl = el('div', { className: 'kpb-column', dataset: { columnId: col.id } });

        // Column reorder drop zone
        if (CAN_EDIT) {
            colEl.addEventListener('dragover', (e) => {
                if (e.dataTransfer.types.includes('kpb/column-index')) {
                    e.preventDefault();
                    colEl.classList.add('drag-over');
                }
            });
            colEl.addEventListener('dragleave', () => colEl.classList.remove('drag-over'));
            colEl.addEventListener('drop', (e) => {
                const fromIdx = e.dataTransfer.getData('kpb/column-index');
                if (fromIdx === '') return;
                colEl.classList.remove('drag-over');
                reorderColumn(parseInt(fromIdx, 10), index);
            });
        }

        colEl.appendChild(header);
        colEl.appendChild(cardsContainer);

        if (CAN_EDIT) {
            colEl.appendChild(el('div', { className: 'kpb-add-card-btn', onClick: () => openCardModal(col.id) }, '+ Add Card'));
        }

        return colEl;
    }

    /* ── Card ── */
    function renderCard(card) {
        const isAdded = addedIds.has(String(card.id));
        const cardEl = el('div', {
            className: 'kpb-card' + (isAdded ? ' added' : ''),
            dataset: { cardId: card.id },
        });

        // Drag (card reorder / move)
        if (CAN_EDIT) {
            cardEl.setAttribute('draggable', 'true');
            cardEl.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                e.dataTransfer.setData('kpb/card-id', String(card.id));
                e.dataTransfer.effectAllowed = 'move';
                cardEl.classList.add('dragging');
            });
            cardEl.addEventListener('dragend', () => cardEl.classList.remove('dragging'));
        }

        // Image
        if (card.image_url) {
            cardEl.appendChild(el('img', { className: 'kpb-card-image', src: card.image_url, alt: card.title || '', loading: 'lazy' }));
        } else {
            cardEl.appendChild(el('div', { className: 'kpb-card-no-image' }, '🖼'));
        }

        const body = el('div', { className: 'kpb-card-body' });

        if (card.title) {
            body.appendChild(el('div', { className: 'kpb-card-title' }, card.title));
        }

        const displayText = card.prompt_text || '';
        if (displayText) {
            body.appendChild(el('div', { className: 'kpb-card-text' }, displayText));
        }

        // Download + Add
        const actions = el('div', { className: 'kpb-card-actions' });

        if (card.image_url) {
            actions.appendChild(el('button', {
                className: 'kpb-card-btn download',
                onClick: (e) => { e.stopPropagation(); downloadImage(card); },
            }, '⬇ Download'));
        }

        actions.appendChild(el('button', {
            className: 'kpb-card-btn add',
            onClick: (e) => { e.stopPropagation(); toggleAddCard(card); },
        }, isAdded ? '✓ Added' : '+ Add'));

        body.appendChild(actions);

        // Edit / Delete (editors only)
        if (CAN_EDIT) {
            const manage = el('div', { className: 'kpb-card-manage' });
            manage.appendChild(el('button', {
                className: 'kpb-card-btn edit',
                onClick: (e) => { e.stopPropagation(); openCardModal(card.column_id, card); },
            }, '✏ Edit'));
            manage.appendChild(el('button', {
                className: 'kpb-card-btn remove',
                onClick: (e) => { e.stopPropagation(); deleteCard(card); },
            }, '🗑 Delete'));
            body.appendChild(manage);
        }

        cardEl.appendChild(body);
        return cardEl;
    }

    /* ── Right Panel ── */
    function renderPanel() {
        const panel = el('div', { className: 'kpb-prompt-panel' });

        panel.appendChild(el('div', { className: 'kpb-panel-title' }, 'Prompt Builder'));

        const countText = prompt.length ? prompt.length + ' snippet' + (prompt.length > 1 ? 's' : '') : '';
        panel.appendChild(el('div', { className: 'kpb-prompt-count' }, countText));

        const text = prompt.map(p => p.text).join(', ');
        const output = el('div', { className: 'kpb-prompt-output' }, text);
        panel.appendChild(output);

        const btns = el('div', { className: 'kpb-panel-buttons' });

        btns.appendChild(el('button', {
            className: 'kpb-panel-btn copy',
            onClick: () => copyPrompt(text),
        }, '📋 Copy'));

        btns.appendChild(el('button', {
            className: 'kpb-panel-btn clear',
            onClick: clearPrompt,
        }, '✕ Clear'));

        panel.appendChild(btns);
        return panel;
    }

    /* ── Actions ── */
    function toggleAddCard(card) {
        const cid = String(card.id);
        if (addedIds.has(cid)) {
            addedIds.delete(cid);
            prompt = prompt.filter(p => p.cardId !== cid);
        } else {
            addedIds.add(cid);
            prompt.push({ cardId: cid, text: card.prompt_text || card.title || '' });
        }
        render();
    }

    function copyPrompt(text) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => {
            const btn = app.querySelector('.kpb-panel-btn.copy');
            if (btn) {
                btn.textContent = '✓ Copied!';
                btn.classList.add('copied');
                setTimeout(() => { btn.textContent = '📋 Copy'; btn.classList.remove('copied'); }, 1500);
            }
        });
    }

    function clearPrompt() {
        prompt = [];
        addedIds.clear();
        render();
    }

    function downloadImage(card) {
        if (!card.image_url) return;
        const a = document.createElement('a');
        a.href = card.image_url;
        const parts = card.image_url.split('/');
        a.download = parts[parts.length - 1] || 'image';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    /* ── Column CRUD ── */
    function addColumn() {
        const name = window.prompt('Column name:');
        if (!name || !name.trim()) return;
        const cols = [...(board.columns_json || [])];
        cols.push({ id: 'col-' + Date.now(), name: name.trim() });
        api('/boards/' + BOARD + '/columns', { method: 'PUT', body: { columns: cols } })
            .then(b => { board = b; render(); });
    }

    function renameColumn(col) {
        const name = window.prompt('Rename column:', col.name);
        if (!name || !name.trim()) return;
        const cols = (board.columns_json || []).map(c => c.id === col.id ? { ...c, name: name.trim() } : c);
        api('/boards/' + BOARD + '/columns', { method: 'PUT', body: { columns: cols } })
            .then(b => { board = b; render(); });
    }

    function deleteColumn(col) {
        if (!window.confirm('Delete column "' + col.name + '" and all its cards?')) return;
        const cols = (board.columns_json || []).filter(c => c.id !== col.id);
        // Delete cards in the column client-side + server
        const colCards = cardsForColumn(col.id);
        const deletePromises = colCards.map(c => api('/cards/' + c.id, { method: 'DELETE' }));
        Promise.all([
            api('/boards/' + BOARD + '/columns', { method: 'PUT', body: { columns: cols } }),
            ...deletePromises,
        ]).then(([b]) => {
            board = b;
            cards = cards.filter(c => c.column_id !== col.id);
            render();
        });
    }

    function reorderColumn(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        const cols = [...(board.columns_json || [])];
        const [moved] = cols.splice(fromIndex, 1);
        cols.splice(toIndex, 0, moved);
        api('/boards/' + BOARD + '/columns', { method: 'PUT', body: { columns: cols } })
            .then(b => { board = b; render(); });
    }

    /* ── Card CRUD ── */
    function moveCard(cardId, columnId, sortOrder) {
        api('/cards/' + cardId + '/move', { method: 'PUT', body: { column_id: columnId, sort_order: sortOrder } })
            .then(() => loadCards());
    }

    function deleteCard(card) {
        if (!window.confirm('Delete this card?')) return;
        api('/cards/' + card.id, { method: 'DELETE' }).then(() => {
            cards = cards.filter(c => c.id !== card.id);
            addedIds.delete(String(card.id));
            prompt = prompt.filter(p => p.cardId !== String(card.id));
            render();
        });
    }

    /* ── Card Modal ── */
    function openCardModal(columnId, existingCard) {
        const isEdit = !!existingCard;
        let imageUrl = existingCard ? existingCard.image_url : '';

        const overlay = el('div', { className: 'kpb-modal-overlay' });
        const modal   = el('div', { className: 'kpb-modal' });

        modal.appendChild(el('h3', {}, isEdit ? 'Edit Card' : 'Add Card'));

        // Image picker
        modal.appendChild(el('label', {}, 'Image'));
        const picker = el('div', { className: 'kpb-image-picker' });
        const pickerContent = () => {
            picker.innerHTML = '';
            if (imageUrl) {
                picker.appendChild(el('img', { src: imageUrl, alt: 'Preview' }));
            } else {
                picker.appendChild(el('div', { className: 'kpb-image-picker-text' }, '📷 Click to select image'));
            }
        };
        pickerContent();

        picker.addEventListener('click', () => {
            // Use WP media library if available
            if (typeof wp !== 'undefined' && wp.media) {
                const frame = wp.media({
                    title: 'Select Card Image',
                    multiple: false,
                    library: { type: 'image' },
                });
                frame.on('select', () => {
                    const attachment = frame.state().get('selection').first().toJSON();
                    imageUrl = attachment.url;
                    pickerContent();
                });
                frame.open();
            } else {
                // Fallback: file input
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.addEventListener('change', () => {
                    if (!input.files.length) return;
                    // Read as data URL for preview; real upload would need server
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        imageUrl = e.target.result;
                        pickerContent();
                    };
                    reader.readAsDataURL(input.files[0]);
                });
                input.click();
            }
        });
        modal.appendChild(picker);

        // Title
        modal.appendChild(el('label', {}, 'Title'));
        const titleInput = el('input', { type: 'text', value: existingCard ? existingCard.title : '', placeholder: 'Card title (optional)' });
        modal.appendChild(titleInput);

        // Prompt text
        modal.appendChild(el('label', {}, 'Prompt Text'));
        const textArea = el('textarea', { placeholder: 'Prompt snippet text…', rows: '3' });
        textArea.value = existingCard ? existingCard.prompt_text : '';
        modal.appendChild(textArea);

        // Buttons
        const actions = el('div', { className: 'kpb-modal-actions' });

        actions.appendChild(el('button', {
            className: 'kpb-modal-btn save',
            onClick: () => {
                const data = {
                    board_id: BOARD,
                    column_id: columnId,
                    title: titleInput.value.trim(),
                    prompt_text: textArea.value.trim(),
                    image_url: imageUrl || '',
                };

                if (isEdit) {
                    api('/cards/' + existingCard.id, { method: 'PUT', body: data }).then(() => loadCards());
                } else {
                    api('/cards', { method: 'POST', body: data }).then(() => loadCards());
                }
                overlay.remove();
            },
        }, isEdit ? 'Save Changes' : 'Add Card'));

        actions.appendChild(el('button', {
            className: 'kpb-modal-btn cancel',
            onClick: () => overlay.remove(),
        }, 'Cancel'));

        modal.appendChild(actions);

        overlay.appendChild(modal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);

        // Focus title
        setTimeout(() => titleInput.focus(), 100);
    }

    /* ── Data Loading ── */
    function loadBoard() {
        return api('/boards/' + BOARD).then(b => { board = b; });
    }

    function loadCards() {
        return api('/cards?board_id=' + BOARD).then(c => { cards = c; render(); });
    }

    function init() {
        loadBoard().then(() => loadCards()).catch(err => {
            app.innerHTML = '<p style="padding:20px;color:#ff6b6b;">Error loading board: ' + err.message + '</p>';
        });
    }

    /* ── Boot ── */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
