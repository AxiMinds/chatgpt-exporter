# ChatGPT Exporter Enhanced v3.0.0

An enhanced userscript for exporting ChatGPT conversations with support for 10k+ messages, Teams accounts, Canvas documents, Code Interpreter outputs, and all file attachments.

## Features

### Core Enhancements
- **Unlimited Message Export**: Bypasses the 1000-message limitation using proper API pagination
- **Teams Account Support**: Automatically detects and handles ChatGPT Teams workspace requirements
- **Anti-Bot Detection**: Implements randomized delays (0.1-3.3 seconds) between API requests
- **Comprehensive Data Extraction**:
  - Full conversation history with message threading
  - Code Interpreter execution results and outputs
  - Canvas documents with complete revision history
  - All uploaded files and attachments
  - DALL-E generated images
  - File citations and references

### Export Formats
- **JSON**: Raw data export with complete metadata
- **JSON (Compressed)**: ZIP archive with JSON data and all attachments
- **Markdown**: Human-readable format with embedded files
- **HTML**: Standalone web pages with syntax highlighting and styling

### File Organization
Exported files are organized in a hierarchical structure:
```
chatgpt_export_[session-id]/
├── index.html (or export.json)
├── conversations/
│   └── [conversation-id]/
│       ├── index.html (or conversation.md)
│       ├── files/
│       │   └── [file-id]/
│       │       └── filename.ext
│       ├── images/
│       │   └── [image-id]/
│       │       └── image.png
│       └── canvas/
│           └── [canvas-id]/
│               └── document-rev-[n].md
```

## Installation

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox, Edge)
   - [Greasemonkey](https://www.greasespot.net/) (Firefox)

2. Install the script:
   - Copy the entire content of `chatgpt-exporter.user.js`
   - Create a new userscript in your manager
   - Paste the code and save

3. Navigate to [ChatGPT](https://chatgpt.com)

## Usage

1. **Export Button**: Look for the "Export All" button in the ChatGPT sidebar
2. **Select Conversations**: 
   - Check individual conversations or use "Select All"
   - The list shows all your conversations with creation dates
3. **Choose Format**: Select your preferred export format from the dropdown
4. **Export Options**:
   - **Export Selected**: Downloads selected conversations in chosen format
   - **Archive Selected**: Archives conversations (Teams feature)
   - **Delete Selected**: Permanently deletes selected conversations

## Technical Details

### API Endpoints Used
- `/backend-api/conversations` - List all conversations with pagination
- `/backend-api/conversation/{id}` - Fetch complete conversation data
- `/backend-api/files/{id}/download` - Download file attachments

### Rate Limiting
- Randomized delays between 100ms and 3300ms per request
- Exponential backoff on rate limit errors (HTTP 429)
- Maximum 3 retry attempts per request
- Automatic token refresh on authentication errors

### Memory Management
- Streaming processing for large conversations
- Incremental saves to prevent memory overflow
- File caching to avoid duplicate downloads
- Progress tracking with real-time updates

## Troubleshooting

### "Authentication Failed" Error
1. Make sure you're logged into ChatGPT
2. Refresh the page and try again
3. Clear browser cache and cookies for chatgpt.com

### Export Stops or Freezes
1. Check browser console for errors (F12)
2. Try exporting fewer conversations at once
3. Ensure stable internet connection
4. Disable other ChatGPT extensions temporarily

### Missing Files or Images
1. Some files may be expired or deleted from OpenAI servers
2. Check the browser console for specific download errors
3. The script logs all failed downloads with details

### Teams Account Issues
1. Ensure you're logged into your Teams workspace
2. The script auto-detects Teams accounts, but you can check the console logs
3. Some Teams features may have different API endpoints

## Configuration

Edit these values in the script's CONFIG object:

```javascript
const CONFIG = {
    API_BASE: 'https://chatgpt.com/backend-api',  // API base URL
    BATCH_SIZE: 100,                               // Conversations per API call
    MAX_RETRIES: 3,                                // Retry attempts for failed requests
    RATE_LIMIT_DELAY: { min: 100, max: 3300 },    // Random delay range (ms)
    MAX_CONCURRENT_DOWNLOADS: 3                     // Parallel file downloads
};
```

## Privacy & Security

- All processing happens locally in your browser
- No data is sent to third-party servers
- Authentication uses your existing ChatGPT session
- Files are downloaded directly from OpenAI servers

## Known Limitations

1. Cannot export conversations you don't have access to
2. Deleted messages may appear as empty in the export
3. Some beta features may not be fully supported
4. Real-time collaboration edits might not be captured

## Contributing

To contribute improvements:

1. Fork the repository
2. Create a feature branch
3. Test thoroughly with various conversation types
4. Submit a pull request with detailed description

## Version History

### v3.0.0 (Current)
- Complete rewrite with enhanced architecture
- Unlimited message export capability
- Teams account support
- Comprehensive content extraction
- Anti-bot detection measures
- Multiple export formats
- Progress tracking UI

### v2.x.x
- Basic export functionality
- Limited to 1000 messages
- JSON and Markdown support

## License

This project is open source and available under the MIT License.

## Credits

Enhanced version by AxiMinds, based on the original chatgpt-exporter by pionxzh.
