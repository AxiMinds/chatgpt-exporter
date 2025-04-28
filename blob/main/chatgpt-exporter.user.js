// ==UserScript==
// @name         ChatGPT Exporter (Forked - Patched)
// @namespace    https://github.com/AxiMinds/chatgpt-exporter 
// @version      2.27.1-patched
// @description  Export and patch ChatGPT conversations easily
// @author       YOUR NAME
// @match        https://chat.openai.com/*
// @icon         https://chat.openai.com/favicon.ico
// @grant        none
// @updateURL    https://raw.githubusercontent.com/AxiMinds/chatgpt-exporter/main/chatgpt-exporter.user.js
// @downloadURL  https://raw.githubusercontent.com/AxiMinds/chatgpt-exporter/main/chatgpt-exporter.user.js
// ==/UserScript==

(function() {
    'use strict';

    /** 
     * ChatGPT Exporter Script Logic
     * (Insert your patched script code here)
     */

    // Example base if needed (replace with actual exporter logic)
    function download(filename, text) {
        const element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
        element.setAttribute('download', filename);
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }

    function exportChat() {
        const chatMessages = [...document.querySelectorAll('.message')].map(e => e.innerText).join('\n\n');
        download('chatgpt-export.txt', chatMessages);
    }

    // Add button to page
    function addExportButton() {
        const nav = document.querySelector('nav');
        if (!nav) return;
        const button = document.createElement('button');
        button.innerText = 'Export Chat';
        button.style.marginLeft = '10px';
        button.onclick = exportChat;
        nav.appendChild(button);
    }

    // Wait until page loads and inject
    window.addEventListener('load', () => {
        setTimeout(addExportButton, 3000);
    });

})();



