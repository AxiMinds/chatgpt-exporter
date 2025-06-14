// ==UserScript==
// @name         ChatGPT Exporter (Batch Fetch 1000 - 20k Limit)
// @namespace    https://github.com/AxiMinds/chatgpt-exporter
// @version      1.0.2
// @description  Export ChatGPT conversations with batch fetches (limit 1000 per call, up to 20k total), with randomized delay to avoid rate-limiting or detection. Button auto-injects in UI and downloads JSON export of all chats fetched via OpenAI API backend endpoint `/backend-api/conversations`.
// @author       AxiMinds
// @match        https://chat.openai.com/*
// @icon         https://chat.openai.com/favicon.ico
// @grant        none
// @updateURL    https://raw.githubusercontent.com/AxiMinds/chatgpt-exporter/main/chatgpt-exporter.user.js
// @downloadURL  https://raw.githubusercontent.com/AxiMinds/chatgpt-exporter/main/chatgpt-exporter.user.js
// ==/UserScript==

(function () {
    'use strict';

    const MAX_CONVERSATIONS = 20000;
    const BATCH_LIMIT = 1000;

    const randomSleep = (min = 300, max = 750) => {
        const ms = Math.floor(Math.random() * (max - min + 1)) + min;
        console.log(`[ChatGPT Exporter] Sleeping ${ms}ms...`);
        return new Promise(resolve => setTimeout(resolve, ms));
    };

    const exportToFile = (data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `chatgpt-conversations-export-${new Date().toISOString()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    async function fetchConversations() {
        let conversations = [];
        let offset = 0;
        let done = false;

        while (!done) {
            const limit = Math.min(BATCH_LIMIT, MAX_CONVERSATIONS - offset);
            console.log(`[ChatGPT Exporter] Requesting offset=${offset}, limit=${limit}`);

            const res = await fetch(`/backend-api/conversations?offset=${offset}&limit=${limit}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!res.ok) {
                console.error(`[ChatGPT Exporter] Failed at offset=${offset}. HTTP ${res.status}`);
                break;
            }

            const data = await res.json();
            if (!data.items || data.items.length === 0) {
                console.log('[ChatGPT Exporter] No more items returned.');
                break;
            }

            conversations.push(...data.items);
            offset += data.items.length;

            if (offset >= MAX_CONVERSATIONS) {
                console.log(`[ChatGPT Exporter] Reached configured MAX_CONVERSATIONS (${MAX_CONVERSATIONS})`);
                done = true;
            }

            await randomSleep(300, 750);
        }

        return conversations;
    }

    function injectExportButton() {
        if (document.getElementById('chatgpt-export-button')) return;

        const nav = document.querySelector('nav') || document.body;
        if (!nav) return;

        const btn = document.createElement('button');
        btn.id = 'chatgpt-export-button';
        btn.innerText = 'Export Conversations';
        btn.style.cssText = `
            margin: 10px;
            padding: 8px 12px;
            border-radius: 6px;
            border: 1px solid #ccc;
            background: #2e7d32;
            color: white;
            cursor: pointer;
        `;

        btn.onclick = async () => {
            console.log('[ChatGPT Exporter] Starting export...');
            const data = await fetchConversations();
            console.log(`[ChatGPT Exporter] Retrieved ${data.length} conversations.`);
            exportToFile(data);
            console.log('[ChatGPT Exporter] Export complete.');
        };

        nav.appendChild(btn);
        console.log('[ChatGPT Exporter] Export button injected.');
    }

    const observer = new MutationObserver(() => {
        if (document.querySelector('nav')) injectExportButton();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[ChatGPT Exporter] Initialized and observing for UI.');
})();
