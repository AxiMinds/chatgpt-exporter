// ==UserScript==
// @name         ChatGPT Exporter Enhanced
// @namespace    https://github.com/AxiMinds/chatgpt-exporter
// @version      3.0.0
// @description  Export ChatGPT conversation history with full content extraction (10k+ messages, Canvas, Code Interpreter, Files)
// @author       AxiMinds (Enhanced)
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @icon         https://chat.openai.com/favicon.ico
// @grant        GM_download
// @grant        GM_notification
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        API_BASE: 'https://chatgpt.com/backend-api',
        BATCH_SIZE: 100,
        MAX_RETRIES: 3,
        RATE_LIMIT_DELAY: { min: 100, max: 3300 }, // 0.1 to 3.3 seconds
        EXPORT_FORMATS: ['json', 'markdown', 'html', 'json-zip', 'filesystem'],
        MAX_CONCURRENT_DOWNLOADS: 3
    };

    // Utility functions
    const utils = {
        delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
        
        randomDelay: () => {
            const { min, max } = CONFIG.RATE_LIMIT_DELAY;
            return Math.floor(Math.random() * (max - min + 1)) + min;
        },
        
        generateUUID: () => {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        },
        
        sanitizeFilename: (filename) => {
            return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 255);
        },
        
        formatBytes: (bytes) => {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }
    };

    // API Client with authentication and rate limiting
    class APIClient {
        constructor() {
            this.token = null;
            this.workspaceId = null;
            this.requestCount = 0;
        }

        async initialize() {
            this.token = await this.extractAuthToken();
            this.workspaceId = await this.detectWorkspaceId();
        }

        async extractAuthToken() {
            // Try multiple methods to extract token
            try {
                // Method 1: From fetch interceptor
                const token = await this.interceptFetch();
                if (token) return token;

                // Method 2: From localStorage
                const authData = localStorage.getItem('@@auth0spajs@@::2yotnuigzNqfFXrCsGrYPUHUiojnIFwn::https://api.openai.com/v1::openid profile email offline_access');
                if (authData) {
                    const parsed = JSON.parse(authData);
                    return parsed.body?.access_token;
                }

                // Method 3: From session storage
                const sessions = Object.keys(sessionStorage).filter(k => k.includes('auth'));
                for (const key of sessions) {
                    const data = JSON.parse(sessionStorage.getItem(key));
                    if (data.accessToken) return data.accessToken;
                }

                throw new Error('Unable to extract authentication token');
            } catch (error) {
                console.error('Token extraction failed:', error);
                throw error;
            }
        }

        async interceptFetch() {
            return new Promise((resolve) => {
                const originalFetch = window.fetch;
                window.fetch = async (...args) => {
                    const [url, options] = args;
                    
                    if (url.includes('/backend-api/') && options?.headers?.Authorization) {
                        const token = options.headers.Authorization.replace('Bearer ', '');
                        window.fetch = originalFetch;
                        resolve(token);
                    }
                    
                    return originalFetch(...args);
                };

                // Timeout after 5 seconds
                setTimeout(() => {
                    window.fetch = originalFetch;
                    resolve(null);
                }, 5000);
            });
        }

        async detectWorkspaceId() {
            try {
                // Check if this is a Teams account
                const response = await this.makeRequest('/accounts/check', { method: 'GET' });
                const data = await response.json();
                
                if (data.account_plan?.includes('team')) {
                    return data.workspace_id || data.team_id;
                }
                
                return null;
            } catch (error) {
                console.log('Not a Teams account or unable to detect workspace');
                return null;
            }
        }

        async makeRequest(endpoint, options = {}) {
            this.requestCount++;
            
            // Apply rate limiting with randomized delay
            if (this.requestCount > 1) {
                const delay = utils.randomDelay();
                console.log(`Rate limiting: waiting ${delay}ms before request #${this.requestCount}`);
                await utils.delay(delay);
            }

            const url = `${CONFIG.API_BASE}${endpoint}`;
            const headers = {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...options.headers
            };

            if (this.workspaceId) {
                headers['X-Workspace-Id'] = this.workspaceId;
            }

            let lastError;
            for (let attempt = 0; attempt < CONFIG.MAX_RETRIES; attempt++) {
                try {
                    const response = await fetch(url, {
                        ...options,
                        headers,
                        credentials: 'include'
                    });

                    if (response.status === 429) {
                        // Rate limited - exponential backoff
                        const retryAfter = response.headers.get('Retry-After') || Math.pow(2, attempt) * 1000;
                        console.warn(`Rate limited. Retrying after ${retryAfter}ms`);
                        await utils.delay(parseInt(retryAfter));
                        continue;
                    }

                    if (response.status === 401) {
                        // Token expired - try to refresh
                        console.log('Token expired, attempting refresh...');
                        this.token = await this.extractAuthToken();
                        continue;
                    }

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }

                    return response;
                } catch (error) {
                    lastError = error;
                    console.error(`Request attempt ${attempt + 1} failed:`, error);
                    
                    if (attempt < CONFIG.MAX_RETRIES - 1) {
                        await utils.delay(Math.pow(2, attempt) * 1000);
                    }
                }
            }

            throw lastError;
        }
    }

    // Data Extractor for comprehensive content extraction
    class DataExtractor {
        constructor(apiClient) {
            this.apiClient = apiClient;
            this.fileCache = new Map();
        }

        async extractConversationData(conversationId, progressCallback) {
            console.log(`Extracting data for conversation: ${conversationId}`);
            
            const response = await this.apiClient.makeRequest(`/conversation/${conversationId}`);
            const conversation = await response.json();
            
            const extractedData = {
                metadata: {
                    id: conversation.id,
                    title: conversation.title,
                    create_time: conversation.create_time,
                    update_time: conversation.update_time,
                    model: conversation.model,
                    workspace_id: this.apiClient.workspaceId
                },
                messages: [],
                files: new Map(),
                images: new Map(),
                codeInterpreterOutputs: [],
                canvasDocuments: [],
                attachments: new Map()
            };

            // Process message tree
            await this.processMessageTree(
                conversation.mapping,
                conversation.current_node,
                extractedData,
                progressCallback
            );

            return extractedData;
        }

        async processMessageTree(mapping, nodeId, extractedData, progressCallback, visited = new Set()) {
            if (!nodeId || visited.has(nodeId)) return;
            visited.add(nodeId);

            const node = mapping[nodeId];
            if (!node) return;

            if (node.message) {
                const message = node.message;
                const processedMessage = {
                    id: message.id,
                    author: message.author,
                    content: message.content,
                    create_time: message.create_time,
                    update_time: message.update_time,
                    status: message.status,
                    metadata: message.metadata,
                    parent: node.parent,
                    children: node.children
                };

                extractedData.messages.push(processedMessage);

                // Extract special content types
                await this.extractSpecialContent(message, extractedData);
                
                if (progressCallback) {
                    progressCallback({
                        type: 'message',
                        id: message.id,
                        total: Object.keys(mapping).length,
                        processed: visited.size
                    });
                }
            }

            // Process all children (handles conversation branches)
            for (const childId of node.children || []) {
                await this.processMessageTree(mapping, childId, extractedData, progressCallback, visited);
            }
        }

        async extractSpecialContent(message, extractedData) {
            // Extract Code Interpreter outputs
            if (message.metadata?.code_interpreter_outputs) {
                for (const output of message.metadata.code_interpreter_outputs) {
                    extractedData.codeInterpreterOutputs.push({
                        messageId: message.id,
                        type: output.type,
                        content: output.content,
                        execution_time: output.execution_time,
                        files_created: output.files_created || []
                    });

                    // Download any files created by code interpreter
                    if (output.files_created) {
                        for (const file of output.files_created) {
                            await this.downloadFile(file, extractedData);
                        }
                    }
                }
            }

            // Extract Canvas documents
            if (message.metadata?.canvas_data) {
                const canvas = message.metadata.canvas_data;
                extractedData.canvasDocuments.push({
                    id: canvas.id,
                    messageId: message.id,
                    title: canvas.title,
                    content: canvas.content,
                    version: canvas.version,
                    revisions: canvas.revisions || [],
                    created_at: canvas.created_at,
                    updated_at: canvas.updated_at
                });
            }

            // Extract attachments and images
            if (message.content?.content_type === 'multimodal_text') {
                for (const part of message.content.parts || []) {
                    if (part.asset_pointer) {
                        await this.extractAsset(part.asset_pointer, extractedData);
                    } else if (part.metadata?.dalle) {
                        await this.extractDalleImage(part, extractedData);
                    }
                }
            }

            // Extract file citations
            if (message.metadata?.citations) {
                for (const citation of message.metadata.citations) {
                    if (citation.metadata?.file_id) {
                        await this.downloadFile({
                            id: citation.metadata.file_id,
                            name: citation.metadata.file_name
                        }, extractedData);
                    }
                }
            }
        }

        async extractAsset(assetPointer, extractedData) {
            try {
                const assetId = assetPointer.asset_id || assetPointer.file_id;
                const fileInfo = {
                    id: assetId,
                    name: assetPointer.file_name || `asset_${assetId}`,
                    size: assetPointer.size_bytes,
                    mimeType: assetPointer.content_type,
                    width: assetPointer.width,
                    height: assetPointer.height
                };

                // Apply rate limiting
                await utils.delay(utils.randomDelay());

                const response = await this.apiClient.makeRequest(`/files/${assetId}/download`);
                const blob = await response.blob();
                
                fileInfo.data = blob;
                
                if (assetPointer.content_type?.startsWith('image/')) {
                    extractedData.images.set(assetId, fileInfo);
                } else {
                    extractedData.files.set(assetId, fileInfo);
                }
            } catch (error) {
                console.error('Failed to extract asset:', error);
            }
        }

        async extractDalleImage(part, extractedData) {
            try {
                const dalle = part.metadata.dalle;
                const imageInfo = {
                    id: dalle.gen_id,
                    prompt: dalle.prompt,
                    seed: dalle.seed,
                    timestamp: dalle.timestamp,
                    name: `dalle_${dalle.gen_id}.png`
                };

                if (part.metadata.url) {
                    // Apply rate limiting
                    await utils.delay(utils.randomDelay());
                    
                    const response = await fetch(part.metadata.url);
                    const blob = await response.blob();
                    imageInfo.data = blob;
                    
                    extractedData.images.set(dalle.gen_id, imageInfo);
                }
            } catch (error) {
                console.error('Failed to extract DALL-E image:', error);
            }
        }

        async downloadFile(fileInfo, extractedData) {
            if (this.fileCache.has(fileInfo.id)) {
                extractedData.files.set(fileInfo.id, this.fileCache.get(fileInfo.id));
                return;
            }

            try {
                // Apply rate limiting
                await utils.delay(utils.randomDelay());
                
                const response = await this.apiClient.makeRequest(`/files/${fileInfo.id}/download`);
                const blob = await response.blob();
                
                const file = {
                    id: fileInfo.id,
                    name: fileInfo.name || `file_${fileInfo.id}`,
                    data: blob,
                    size: blob.size,
                    mimeType: blob.type
                };
                
                this.fileCache.set(fileInfo.id, file);
                extractedData.files.set(fileInfo.id, file);
            } catch (error) {
                console.error(`Failed to download file ${fileInfo.id}:`, error);
            }
        }
    }

    // Conversation Manager for handling bulk operations
    class ConversationManager {
        constructor(apiClient) {
            this.apiClient = apiClient;
            this.conversations = new Map();
        }

        async fetchAllConversations(progressCallback) {
            console.log('Fetching all conversations...');
            
            let offset = 0;
            let hasMore = true;
            const allConversations = [];

            while (hasMore) {
                try {
                    const response = await this.apiClient.makeRequest(
                        `/conversations?offset=${offset}&limit=${CONFIG.BATCH_SIZE}`
                    );
                    const data = await response.json();
                    
                    allConversations.push(...data.items);
                    
                    if (progressCallback) {
                        progressCallback({
                            type: 'conversation_list',
                            fetched: allConversations.length,
                            total: data.total
                        });
                    }

                    hasMore = data.items.length === CONFIG.BATCH_SIZE && allConversations.length < data.total;
                    offset += CONFIG.BATCH_SIZE;

                    console.log(`Fetched ${allConversations.length}/${data.total} conversations`);
                } catch (error) {
                    console.error('Error fetching conversations:', error);
                    hasMore = false;
                }
            }

            // Store in map for easy access
            allConversations.forEach(conv => {
                this.conversations.set(conv.id, conv);
            });

            return allConversations;
        }

        async archiveConversations(conversationIds) {
            const results = [];
            
            for (const id of conversationIds) {
                try {
                    await this.apiClient.makeRequest(`/conversation/${id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ is_archived: true })
                    });
                    
                    results.push({ id, success: true });
                } catch (error) {
                    results.push({ id, success: false, error: error.message });
                }
            }
            
            return results;
        }

        async deleteConversations(conversationIds) {
            const results = [];
            
            for (const id of conversationIds) {
                try {
                    await this.apiClient.makeRequest(`/conversation/${id}`, {
                        method: 'DELETE'
                    });
                    
                    results.push({ id, success: true });
                } catch (error) {
                    results.push({ id, success: false, error: error.message });
                }
            }
            
            return results;
        }
    }

    // Export Manager for different export formats
    class ExportManager {
        constructor(apiClient, dataExtractor) {
            this.apiClient = apiClient;
            this.dataExtractor = dataExtractor;
            this.exportSession = null;
        }

        createExportSession() {
            this.exportSession = {
                id: utils.generateUUID(),
                startTime: Date.now(),
                conversations: new Map(),
                errors: [],
                stats: {
                    totalConversations: 0,
                    totalMessages: 0,
                    totalFiles: 0,
                    totalImages: 0,
                    totalSize: 0
                }
            };
            
            return this.exportSession;
        }

        async exportConversations(conversations, format, options = {}) {
            const session = this.createExportSession();
            session.stats.totalConversations = conversations.length;

            const results = {
                successful: [],
                failed: [],
                session: session
            };

            for (let i = 0; i < conversations.length; i++) {
                const conv = conversations[i];
                
                try {
                    console.log(`Exporting conversation ${i + 1}/${conversations.length}: ${conv.title}`);
                    
                    const data = await this.dataExtractor.extractConversationData(
                        conv.id,
                        (progress) => this.updateProgress(conv.id, progress)
                    );
                    
                    session.conversations.set(conv.id, data);
                    session.stats.totalMessages += data.messages.length;
                    session.stats.totalFiles += data.files.size;
                    session.stats.totalImages += data.images.size;
                    
                    results.successful.push(conv.id);
                    
                } catch (error) {
                    console.error(`Failed to export conversation ${conv.id}:`, error);
                    session.errors.push({ conversationId: conv.id, error: error.message });
                    results.failed.push(conv.id);
                }
            }

            // Export based on format
            const exportResult = await this.performExport(session, format, options);
            
            return { ...results, exportResult };
        }

        async performExport(session, format, options) {
            switch (format) {
                case 'json':
                    return this.exportAsJSON(session, false);
                case 'json-zip':
                    return this.exportAsJSON(session, true);
                case 'markdown':
                    return this.exportAsMarkdown(session);
                case 'html':
                    return this.exportAsHTML(session);
                case 'filesystem':
                    return this.exportAsFileSystem(session, options);
                default:
                    throw new Error(`Unsupported export format: ${format}`);
            }
        }

        async exportAsJSON(session, compress = false) {
            const exportData = {
                export_date: new Date().toISOString(),
                export_version: '3.0.0',
                session_id: session.id,
                stats: session.stats,
                conversations: []
            };

            for (const [convId, convData] of session.conversations) {
                const conversation = {
                    ...convData.metadata,
                    messages: convData.messages,
                    code_interpreter_outputs: convData.codeInterpreterOutputs,
                    canvas_documents: convData.canvasDocuments,
                    files: Array.from(convData.files.entries()).map(([id, file]) => ({
                        id,
                        name: file.name,
                        size: file.size,
                        mimeType: file.mimeType
                    })),
                    images: Array.from(convData.images.entries()).map(([id, image]) => ({
                        id,
                        name: image.name,
                        size: image.size,
                        mimeType: image.mimeType,
                        dimensions: image.width ? `${image.width}x${image.height}` : null
                    }))
                };
                
                exportData.conversations.push(conversation);
            }

            const jsonString = JSON.stringify(exportData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            
            if (compress) {
                return this.createZipArchive(session, blob);
            } else {
                this.downloadFile(blob, `chatgpt_export_${session.id}.json`);
                return { success: true, format: 'json' };
            }
        }

        async exportAsMarkdown(session) {
            const zip = new JSZip();
            
            for (const [convId, convData] of session.conversations) {
                let markdown = `# ${convData.metadata.title}\n\n`;
                markdown += `**Created:** ${new Date(convData.metadata.create_time * 1000).toLocaleString()}\n\n`;
                markdown += `---\n\n`;

                // Group messages by parent-child relationship
                const messageTree = this.buildMessageTree(convData.messages);
                markdown += this.renderMessageTree(messageTree, convData);

                // Add file references
                if (convData.files.size > 0) {
                    markdown += '\n\n## Attachments\n\n';
                    for (const [id, file] of convData.files) {
                        markdown += `- [${file.name}](files/${id}/${file.name})\n`;
                        
                        // Add file to zip
                        if (file.data) {
                            zip.file(`conversations/${convId}/files/${id}/${file.name}`, file.data);
                        }
                    }
                }

                // Add images
                if (convData.images.size > 0) {
                    markdown += '\n\n## Images\n\n';
                    for (const [id, image] of convData.images) {
                        markdown += `![${image.name}](images/${id}/${image.name})\n\n`;
                        
                        // Add image to zip
                        if (image.data) {
                            zip.file(`conversations/${convId}/images/${id}/${image.name}`, image.data);
                        }
                    }
                }

                zip.file(`conversations/${convId}/${utils.sanitizeFilename(convData.metadata.title)}.md`, markdown);
            }

            // Generate and download zip
            const blob = await zip.generateAsync({ type: 'blob' });
            this.downloadFile(blob, `chatgpt_export_markdown_${session.id}.zip`);
            
            return { success: true, format: 'markdown-zip' };
        }

        async exportAsHTML(session) {
            const zip = new JSZip();
            
            // Create index.html
            let indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ChatGPT Export - ${new Date().toLocaleDateString()}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
        .conversation-list { list-style: none; padding: 0; }
        .conversation-item { margin: 10px 0; padding: 15px; border: 1px solid #e0e0e0; border-radius: 8px; }
        .conversation-item:hover { background-color: #f5f5f5; }
        .stats { background-color: #f0f0f0; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        h1 { color: #333; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>ChatGPT Export</h1>
    <div class="stats">
        <h3>Export Statistics</h3>
        <p>Total Conversations: ${session.stats.totalConversations}</p>
        <p>Total Messages: ${session.stats.totalMessages}</p>
        <p>Total Files: ${session.stats.totalFiles}</p>
        <p>Total Images: ${session.stats.totalImages}</p>
        <p>Export Date: ${new Date().toLocaleString()}</p>
    </div>
    <h2>Conversations</h2>
    <ul class="conversation-list">`;

            for (const [convId, convData] of session.conversations) {
                const safeTitle = utils.sanitizeFilename(convData.metadata.title);
                indexHtml += `
        <li class="conversation-item">
            <h3><a href="conversations/${convId}/index.html">${convData.metadata.title}</a></h3>
            <p>Messages: ${convData.messages.length} | Created: ${new Date(convData.metadata.create_time * 1000).toLocaleDateString()}</p>
        </li>`;

                // Create conversation HTML
                const convHtml = await this.generateConversationHTML(convData);
                zip.file(`conversations/${convId}/index.html`, convHtml);

                // Add files and images
                for (const [id, file] of convData.files) {
                    if (file.data) {
                        zip.file(`conversations/${convId}/files/${id}/${file.name}`, file.data);
                    }
                }

                for (const [id, image] of convData.images) {
                    if (image.data) {
                        zip.file(`conversations/${convId}/images/${id}/${image.name}`, image.data);
                    }
                }
            }

            indexHtml += `
    </ul>
</body>
</html>`;

            zip.file('index.html', indexHtml);

            // Generate and download zip
            const blob = await zip.generateAsync({ type: 'blob' });
            this.downloadFile(blob, `chatgpt_export_html_${session.id}.zip`);
            
            return { success: true, format: 'html-zip' };
        }

        async generateConversationHTML(convData) {
            let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${convData.metadata.title}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; line-height: 1.6; }
        .message { margin: 20px 0; padding: 15px; border-radius: 8px; }
        .user-message { background-color: #e3f2fd; border-left: 4px solid #2196f3; }
        .assistant-message { background-color: #f5f5f5; border-left: 4px solid #4caf50; }
        .system-message { background-color: #fff3e0; border-left: 4px solid #ff9800; }
        .message-header { font-weight: bold; margin-bottom: 10px; color: #666; }
        .message-content { white-space: pre-wrap; }
        .code-block { background-color: #282c34; color: #abb2bf; padding: 15px; border-radius: 5px; overflow-x: auto; }
        .timestamp { font-size: 0.9em; color: #999; }
        .attachment { margin: 10px 0; padding: 10px; background-color: #f0f0f0; border-radius: 5px; }
        .canvas-document { margin: 15px 0; padding: 15px; background-color: #e8f5e9; border-radius: 8px; }
        img { max-width: 100%; height: auto; }
        a { color: #0066cc; }
        pre { background-color: #f5f5f5; padding: 10px; border-radius: 5px; overflow-x: auto; }
        code { background-color: #f5f5f5; padding: 2px 4px; border-radius: 3px; }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/github.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
</head>
<body>
    <h1>${convData.metadata.title}</h1>
    <p class="timestamp">Created: ${new Date(convData.metadata.create_time * 1000).toLocaleString()}</p>
    <hr>`;

            // Render messages
            const messageTree = this.buildMessageTree(convData.messages);
            html += this.renderMessageTreeHTML(messageTree, convData);

            // Add Canvas documents
            if (convData.canvasDocuments.length > 0) {
                html += '<h2>Canvas Documents</h2>';
                for (const canvas of convData.canvasDocuments) {
                    html += `
    <div class="canvas-document">
        <h3>${canvas.title}</h3>
        <div class="message-content">${this.escapeHtml(canvas.content)}</div>
        <p class="timestamp">Version: ${canvas.version} | Updated: ${new Date(canvas.updated_at).toLocaleString()}</p>
    </div>`;
                }
            }

            // Add attachments
            if (convData.files.size > 0) {
                html += '<h2>Attachments</h2>';
                for (const [id, file] of convData.files) {
                    html += `
    <div class="attachment">
        <a href="files/${id}/${file.name}" download="${file.name}">${file.name}</a>
        <span class="timestamp">(${utils.formatBytes(file.size)})</span>
    </div>`;
                }
            }

            // Add images
            if (convData.images.size > 0) {
                html += '<h2>Images</h2>';
                for (const [id, image] of convData.images) {
                    html += `
    <div class="attachment">
        <img src="images/${id}/${image.name}" alt="${image.name}">
        <p>${image.name}</p>
    </div>`;
                }
            }

            html += `
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            document.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        });
    </script>
</body>
</html>`;

            return html;
        }

        buildMessageTree(messages) {
            const tree = new Map();
            const roots = [];

            // Create a map of all messages
            const messageMap = new Map();
            messages.forEach(msg => messageMap.set(msg.id, msg));

            // Build the tree
            messages.forEach(msg => {
                if (!msg.parent || !messageMap.has(msg.parent)) {
                    roots.push(msg);
                } else {
                    if (!tree.has(msg.parent)) {
                        tree.set(msg.parent, []);
                    }
                    tree.get(msg.parent).push(msg);
                }
            });

            return { roots, tree };
        }

        renderMessageTree(messageTree, convData, depth = 0) {
            let output = '';

            const renderMessage = (message, depth) => {
                const indent = '  '.repeat(depth);
                const role = message.author?.role || 'unknown';
                const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
                
                output += `${indent}**${roleLabel}:** `;
                
                if (message.content?.content_type === 'text') {
                    output += `${message.content.parts.join('')}\n\n`;
                } else if (message.content?.content_type === 'multimodal_text') {
                    for (const part of message.content.parts) {
                        if (typeof part === 'string') {
                            output += part;
                        } else if (part.asset_pointer) {
                            const file = convData.files.get(part.asset_pointer.asset_id) || 
                                       convData.images.get(part.asset_pointer.asset_id);
                            if (file) {
                                output += `[${file.name}]`;
                            }
                        }
                    }
                    output += '\n\n';
                }

                // Render children
                const children = messageTree.tree.get(message.id) || [];
                children.forEach(child => renderMessage(child, depth + 1));
            };

            messageTree.roots.forEach(root => renderMessage(root, depth));
            
            return output;
        }

        renderMessageTreeHTML(messageTree, convData, depth = 0) {
            let html = '';

            const renderMessage = (message, depth) => {
                const role = message.author?.role || 'unknown';
                const roleClass = `${role}-message`;
                const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
                
                html += `<div class="message ${roleClass}" style="margin-left: ${depth * 20}px;">`;
                html += `<div class="message-header">${roleLabel}</div>`;
                html += '<div class="message-content">';
                
                if (message.content?.content_type === 'text') {
                    html += this.formatContent(message.content.parts.join(''));
                } else if (message.content?.content_type === 'multimodal_text') {
                    for (const part of message.content.parts) {
                        if (typeof part === 'string') {
                            html += this.formatContent(part);
                        } else if (part.asset_pointer) {
                            const file = convData.files.get(part.asset_pointer.asset_id) || 
                                       convData.images.get(part.asset_pointer.asset_id);
                            if (file) {
                                if (convData.images.has(part.asset_pointer.asset_id)) {
                                    html += `<img src="images/${part.asset_pointer.asset_id}/${file.name}" alt="${file.name}">`;
                                } else {
                                    html += `<a href="files/${part.asset_pointer.asset_id}/${file.name}">${file.name}</a>`;
                                }
                            }
                        }
                    }
                }
                
                html += '</div>';
                
                if (message.create_time) {
                    html += `<div class="timestamp">${new Date(message.create_time * 1000).toLocaleString()}</div>`;
                }
                
                html += '</div>';

                // Render children
                const children = messageTree.tree.get(message.id) || [];
                children.forEach(child => renderMessage(child, depth + 1));
            };

            messageTree.roots.forEach(root => renderMessage(root, depth));
            
            return html;
        }

        formatContent(content) {
            // Escape HTML
            let formatted = this.escapeHtml(content);
            
            // Format code blocks
            formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
                return `<pre><code class="language-${lang || 'plaintext'}">${code.trim()}</code></pre>`;
            });
            
            // Format inline code
            formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
            
            // Format bold
            formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            
            // Format italic
            formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
            
            // Format links
            formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
            
            // Format line breaks
            formatted = formatted.replace(/\n/g, '<br>');
            
            return formatted;
        }

        escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            
            return text.replace(/[&<>"']/g, m => map[m]);
        }

        async createZipArchive(session, mainFile) {
            const zip = new JSZip();
            
            // Add main export file
            zip.file('export.json', mainFile);
            
            // Add all files and images
            for (const [convId, convData] of session.conversations) {
                const convFolder = `conversations/${convId}`;
                
                // Add files
                for (const [fileId, file] of convData.files) {
                    if (file.data) {
                        zip.file(`${convFolder}/files/${fileId}/${file.name}`, file.data);
                    }
                }
                
                // Add images
                for (const [imageId, image] of convData.images) {
                    if (image.data) {
                        zip.file(`${convFolder}/images/${imageId}/${image.name}`, image.data);
                    }
                }
            }
            
            // Generate zip
            const blob = await zip.generateAsync({ type: 'blob' });
            this.downloadFile(blob, `chatgpt_export_${session.id}.zip`);
            
            return { success: true, format: 'json-zip' };
        }

        downloadFile(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        updateProgress(conversationId, progress) {
            // Update UI progress indicator
            if (window.ChatGPTExporterUI) {
                window.ChatGPTExporterUI.updateProgress(conversationId, progress);
            }
        }
    }

    // UI Manager
    class ExporterUI {
        constructor() {
            this.container = null;
            this.progressModal = null;
            this.selectedConversations = new Set();
        }

        inject() {
            // Wait for the page to load
            const observer = new MutationObserver((mutations, obs) => {
                const sidebar = document.querySelector('nav');
                if (sidebar) {
                    this.createUI();
                    obs.disconnect();
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        createUI() {
            // Create export button
            const exportButton = document.createElement('button');
            exportButton.className = 'chatgpt-exporter-btn';
            exportButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Export All
            `;
            exportButton.onclick = () => this.showExportModal();

            // Add styles
            this.injectStyles();

            // Find a good place to insert the button
            const nav = document.querySelector('nav');
            if (nav) {
                const navButtons = nav.querySelector('div[class*="flex-col"]');
                if (navButtons) {
                    navButtons.appendChild(exportButton);
                }
            }

            // Store reference globally
            window.ChatGPTExporterUI = this;
        }

        injectStyles() {
            const style = document.createElement('style');
            style.textContent = `
                .chatgpt-exporter-btn {
                    width: 100%;
                    padding: 12px;
                    margin: 4px 0;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    background: transparent;
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 6px;
                    color: white;
                    cursor: pointer;
                    transition: all 0.2s;
                    font-size: 14px;
                }
                
                .chatgpt-exporter-btn:hover {
                    background: rgba(255,255,255,0.1);
                }
                
                .exporter-modal {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0,0,0,0.5);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10000;
                }
                
                .exporter-modal-content {
                    background: white;
                    border-radius: 12px;
                    width: 90%;
                    max-width: 600px;
                    max-height: 80vh;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                }
                
                .exporter-modal-header {
                    padding: 20px;
                    border-bottom: 1px solid #e0e0e0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .exporter-modal-body {
                    padding: 20px;
                    overflow-y: auto;
                    flex: 1;
                }
                
                .exporter-modal-footer {
                    padding: 20px;
                    border-top: 1px solid #e0e0e0;
                    display: flex;
                    gap: 10px;
                    justify-content: flex-end;
                }
                
                .conversation-list {
                    max-height: 300px;
                    overflow-y: auto;
                    border: 1px solid #e0e0e0;
                    border-radius: 6px;
                    padding: 10px;
                    margin: 10px 0;
                }
                
                .conversation-item {
                    padding: 8px;
                    margin: 4px 0;
                    border-radius: 4px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                
                .conversation-item:hover {
                    background: #f5f5f5;
                }
                
                .conversation-item.selected {
                    background: #e3f2fd;
                }
                
                .conversation-item input[type="checkbox"] {
                    flex-shrink: 0;
                }
                
                .export-options {
                    margin: 20px 0;
                }
                
                .export-format {
                    margin: 10px 0;
                }
                
                .export-btn {
                    padding: 10px 20px;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-weight: 500;
                    transition: all 0.2s;
                }
                
                .export-btn.primary {
                    background: #10a37f;
                    color: white;
                }
                
                .export-btn.primary:hover {
                    background: #0d8f6f;
                }
                
                .export-btn.secondary {
                    background: #f0f0f0;
                    color: #333;
                }
                
                .export-btn.danger {
                    background: #ff4444;
                    color: white;
                }
                
                .progress-modal {
                    position: fixed;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: white;
                    padding: 30px;
                    border-radius: 12px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                    min-width: 400px;
                    z-index: 10001;
                }
                
                .progress-bar {
                    width: 100%;
                    height: 20px;
                    background: #f0f0f0;
                    border-radius: 10px;
                    overflow: hidden;
                    margin: 20px 0;
                }
                
                .progress-fill {
                    height: 100%;
                    background: #10a37f;
                    transition: width 0.3s;
                }
                
                .progress-text {
                    text-align: center;
                    margin: 10px 0;
                    color: #666;
                }
                
                .close-btn {
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: #999;
                }
            `;
            document.head.appendChild(style);
        }

        async showExportModal() {
            // Initialize API client
            const apiClient = new APIClient();
            try {
                await apiClient.initialize();
            } catch (error) {
                alert('Failed to initialize. Please make sure you are logged in to ChatGPT.');
                return;
            }

            // Create modal
            const modal = document.createElement('div');
            modal.className = 'exporter-modal';
            modal.innerHTML = `
                <div class="exporter-modal-content">
                    <div class="exporter-modal-header">
                        <h2>Export Conversations</h2>
                        <button class="close-btn" onclick="this.closest('.exporter-modal').remove()">&times;</button>
                    </div>
                    <div class="exporter-modal-body">
                        <div class="export-options">
                            <label>
                                <input type="checkbox" id="select-all"> Select All Conversations
                            </label>
                        </div>
                        <div class="conversation-list" id="conversation-list">
                            <div style="text-align: center; padding: 20px;">
                                Loading conversations...
                            </div>
                        </div>
                        <div class="export-format">
                            <label>Export Format:</label>
                            <select id="export-format">
                                <option value="json">JSON</option>
                                <option value="json-zip">JSON (Compressed)</option>
                                <option value="markdown">Markdown</option>
                                <option value="html">HTML</option>
                            </select>
                        </div>
                    </div>
                    <div class="exporter-modal-footer">
                        <button class="export-btn secondary" onclick="this.closest('.exporter-modal').remove()">Cancel</button>
                        <button class="export-btn danger" id="delete-btn">Delete Selected</button>
                        <button class="export-btn secondary" id="archive-btn">Archive Selected</button>
                        <button class="export-btn primary" id="export-btn">Export Selected</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);

            // Load conversations
            const convManager = new ConversationManager(apiClient);
            const conversations = await convManager.fetchAllConversations((progress) => {
                const listDiv = document.getElementById('conversation-list');
                listDiv.innerHTML = `
                    <div style="text-align: center; padding: 20px;">
                        Loading conversations... ${progress.fetched}/${progress.total}
                    </div>
                `;
            });

            // Display conversations
            this.displayConversations(conversations);

            // Set up event listeners
            document.getElementById('select-all').addEventListener('change', (e) => {
                const checkboxes = document.querySelectorAll('.conversation-item input[type="checkbox"]');
                checkboxes.forEach(cb => cb.checked = e.target.checked);
                this.updateSelectedConversations();
            });

            document.getElementById('export-btn').addEventListener('click', async () => {
                await this.handleExport(apiClient, convManager);
            });

            document.getElementById('archive-btn').addEventListener('click', async () => {
                await this.handleArchive(apiClient, convManager);
            });

            document.getElementById('delete-btn').addEventListener('click', async () => {
                await this.handleDelete(apiClient, convManager);
            });
        }

        displayConversations(conversations) {
            const listDiv = document.getElementById('conversation-list');
            listDiv.innerHTML = '';

            conversations.forEach(conv => {
                const item = document.createElement('div');
                item.className = 'conversation-item';
                item.innerHTML = `
                    <input type="checkbox" value="${conv.id}" onchange="window.ChatGPTExporterUI.updateSelectedConversations()">
                    <div style="flex: 1;">
                        <div style="font-weight: 500;">${conv.title}</div>
                        <div style="font-size: 12px; color: #666;">
                            ${new Date(conv.create_time * 1000).toLocaleDateString()}
                        </div>
                    </div>
                `;
                
                listDiv.appendChild(item);
            });
        }

        updateSelectedConversations() {
            this.selectedConversations.clear();
            const checkboxes = document.querySelectorAll('.conversation-item input[type="checkbox"]:checked');
            checkboxes.forEach(cb => this.selectedConversations.add(cb.value));
            
            // Update button states
            const hasSelection = this.selectedConversations.size > 0;
            document.getElementById('export-btn').disabled = !hasSelection;
            document.getElementById('archive-btn').disabled = !hasSelection;
            document.getElementById('delete-btn').disabled = !hasSelection;
        }

        async handleExport(apiClient, convManager) {
            const format = document.getElementById('export-format').value;
            const selectedIds = Array.from(this.selectedConversations);
            
            if (selectedIds.length === 0) {
                alert('Please select at least one conversation to export.');
                return;
            }

            // Close modal
            document.querySelector('.exporter-modal').remove();

            // Show progress
            this.showProgress('Exporting conversations...');

            try {
                const dataExtractor = new DataExtractor(apiClient);
                const exportManager = new ExportManager(apiClient, dataExtractor);
                
                // Get full conversation data
                const conversations = selectedIds.map(id => 
                    convManager.conversations.get(id)
                ).filter(Boolean);
                
                const result = await exportManager.exportConversations(conversations, format);
                
                this.hideProgress();
                
                // Show result notification
                GM_notification({
                    title: 'Export Complete',
                    text: `Successfully exported ${result.successful.length} conversations. Failed: ${result.failed.length}`,
                    timeout: 5000
                });
                
            } catch (error) {
                this.hideProgress();
                console.error('Export error:', error);
                alert(`Export failed: ${error.message}`);
            }
        }

        async handleArchive(apiClient, convManager) {
            const selectedIds = Array.from(this.selectedConversations);
            
            if (selectedIds.length === 0) {
                alert('Please select at least one conversation to archive.');
                return;
            }

            if (!confirm(`Archive ${selectedIds.length} conversations?`)) {
                return;
            }

            // Close modal
            document.querySelector('.exporter-modal').remove();

            // Show progress
            this.showProgress('Archiving conversations...');

            try {
                const results = await convManager.archiveConversations(selectedIds);
                
                this.hideProgress();
                
                const successful = results.filter(r => r.success).length;
                const failed = results.filter(r => !r.success).length;
                
                GM_notification({
                    title: 'Archive Complete',
                    text: `Successfully archived ${successful} conversations. Failed: ${failed}`,
                    timeout: 5000
                });
                
            } catch (error) {
                this.hideProgress();
                console.error('Archive error:', error);
                alert(`Archive failed: ${error.message}`);
            }
        }

        async handleDelete(apiClient, convManager) {
            const selectedIds = Array.from(this.selectedConversations);
            
            if (selectedIds.length === 0) {
                alert('Please select at least one conversation to delete.');
                return;
            }

            if (!confirm(`Permanently delete ${selectedIds.length} conversations? This cannot be undone.`)) {
                return;
            }

            // Close modal
            document.querySelector('.exporter-modal').remove();

            // Show progress
            this.showProgress('Deleting conversations...');

            try {
                const results = await convManager.deleteConversations(selectedIds);
                
                this.hideProgress();
                
                const successful = results.filter(r => r.success).length;
                const failed = results.filter(r => !r.success).length;
                
                GM_notification({
                    title: 'Delete Complete',
                    text: `Successfully deleted ${successful} conversations. Failed: ${failed}`,
                    timeout: 5000
                });
                
                // Refresh page to update conversation list
                setTimeout(() => location.reload(), 2000);
                
            } catch (error) {
                this.hideProgress();
                console.error('Delete error:', error);
                alert(`Delete failed: ${error.message}`);
            }
        }

        showProgress(message) {
            this.progressModal = document.createElement('div');
            this.progressModal.className = 'progress-modal';
            this.progressModal.innerHTML = `
                <h3>${message}</h3>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
                <div class="progress-text">Initializing...</div>
            `;
            document.body.appendChild(this.progressModal);
        }

        updateProgress(conversationId, progress) {
            if (!this.progressModal) return;

            const progressBar = this.progressModal.querySelector('.progress-fill');
            const progressText = this.progressModal.querySelector('.progress-text');

            if (progress.type === 'message') {
                const percent = (progress.processed / progress.total) * 100;
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `Processing messages: ${progress.processed}/${progress.total}`;
            } else if (progress.type === 'conversation_list') {
                const percent = (progress.fetched / progress.total) * 100;
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `Fetching conversations: ${progress.fetched}/${progress.total}`;
            }
        }

        hideProgress() {
            if (this.progressModal) {
                this.progressModal.remove();
                this.progressModal = null;
            }
        }
    }

    // Load JSZip library
    const loadJSZip = () => {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    };

    // Initialize
    async function init() {
        console.log('ChatGPT Exporter Enhanced v3.0.0 initializing...');
        
        // Load dependencies
        await loadJSZip();
        
        // Create UI
        const ui = new ExporterUI();
        ui.inject();
        
        console.log('ChatGPT Exporter Enhanced ready!');
    }

    // Start when page is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
