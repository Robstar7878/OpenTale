/**
 * OpenTale Quill Handler
 *
 * This script provides a modern, class-based implementation for managing Quill.js editors.
 * It encapsulates all editor-related logic, including custom blots, toolbar handlers,
 * LLM streaming integration, and event management, without relying on jQuery.
 *
 * Core Features:
 * - Encapsulates each editor in a `QuillHandler` instance.
 * - Removes jQuery dependency for faster, more modern code.
 * - Manages LLM interactions (continue and revise) via streaming APIs.
 * - Provides hotkeys for running (`\`), accepting (`=`), and rejecting (`Escape`) LLM suggestions.
 * - Includes custom toolbar icons and functionalities like a divider and content viewers.
 * - Persists font size settings in local storage.
 * - Converts editor content to Markdown for form submission.
 */
document.addEventListener('DOMContentLoaded', () => {
    const Clipboard = Quill.import('modules/clipboard');
    const Delta = Quill.import('delta');

    class MarkdownClipboard extends Clipboard {
        constructor(quill, options) {
            super(quill, options);
            this.keepSelection = options.keepSelection || false;
        }

        onCapturePaste(e) {
            if (e.defaultPrevented || !this.quill.isEnabled()) return;
            e.preventDefault();
            
            const range = this.quill.getSelection();
            if (range == null) return;

            let text = e.clipboardData?.getData('text/plain');
            let html = e.clipboardData?.getData('text/html');
            let delta = new Delta().retain(range.index).delete(range.length);
            let insertedLength = 0;

            // Handle text/html/markdown content
            if (this.isMarkdown(text)) {
                // Convert Markdown to HTML using Showdown
                const content = showdownConverter.makeHtml(text);
                const convertedDelta = this.convert({ html: content });
                delta = delta.concat(convertedDelta);
                insertedLength = convertedDelta.length();
            } else if (!html) {
                // Handle plain text
                delta = delta.insert(text);
                insertedLength = text.length;
            } else {
                // Handle HTML content
                const convertedDelta = this.convert({ html });
                delta = delta.concat(convertedDelta);
                insertedLength = convertedDelta.length();
            }

            this.quill.updateContents(delta, Quill.sources.USER);

            // Update cursor position
            const cursorPosition = range.index + insertedLength;
            if (this.keepSelection) {
                this.quill.setSelection(range.index, insertedLength, Quill.sources.SILENT);
            } else {
                this.quill.setSelection(cursorPosition, 0, Quill.sources.SILENT);
            }

            this.quill.scrollSelectionIntoView();

            // dont need to call updateHiddenInput here, as it will be called by the text-change event
        }

        isMarkdown(text) {
            const lines = text.split('\n');
            // More specific patterns to avoid false positives, especially for inline styles.
            const markdownPatterns = [
                // Block-level patterns (strong indicators)
                /^#{1,6}\s+/,      // Headers
                /^\s*[-*+]\s+/,   // Unordered list items
                /^\s*\d+\.\s+/,   // Ordered lists
                /^\s*>\s+/,       // Blockquotes
                /^\s*```/,        // Fenced code blocks
                /^\s*---\s*$/,    // Horizontal Rules
                /!\[.*\]\(.*\)/,   // Images
                /\[.*\]\(.*\)/,   // Links

                // Inline patterns (weaker indicators, made more specific)
                // Requires non-whitespace characters immediately inside markers.
                /\*\*(\S(.*\S)?)\*\*/, // Bold (e.g., **word**)
                /__(\S(.*\S)?)__/,   // Bold (e.g., __word__)
                /\*(\S(.*\S)?)\*/,   // Italic (e.g., *word*)
                /_(\S(.*\S)?)_/,     // Italic (e.g., _word_)
                /`[^`]+`/            // Inline code (e.g., `code`)
            ];

            // If any line matches any pattern, we'll treat it as Markdown.
            // This is a practical heuristic for paste handling.
            return lines.some(line => markdownPatterns.some(pattern => pattern.test(line)));
        }
    }
    
    // Initialize converters once
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        bulletListMarker: '-',
        emDelimiter: '*',
        strongDelimiter: '**',
        hr: '* * *',
        codeBlockStyle: 'fenced'
    });
    const showdownConverter = new showdown.Converter({
        tables: false,
        strikethrough: false,
        tasklists: false,
        simplifiedAutoLink: true,
        simpleLineBreaks: false, // Ensure single line breaks don't create new paragraphs
        noHeaderId: true // Avoid adding IDs to headers
    });

    // Define and register custom Quill blots and icons
    // This is done once, outside the class, to avoid re-registering on every instance.
    function registerCustomQuillFeatures() {
        const Inline = Quill.import('blots/inline');
        const BlockEmbed = Quill.import('blots/block/embed');

        // HighlightBlot: <mark class="highlight-text">
        class HighlightBlot extends Inline {}
        HighlightBlot.blotName = 'highlight';
        HighlightBlot.tagName = 'mark';
        HighlightBlot.className = 'highlight-text';

        // DividerBlot: <hr>
        class DividerBlot extends BlockEmbed {}
        DividerBlot.blotName = 'divider';
        DividerBlot.tagName = 'hr';

        Quill.register(HighlightBlot);
        Quill.register(DividerBlot);

        // Register the fullscreen toggle module
        Quill.register('modules/toggleFullscreen', QuillToggleFullscreenButton);

        // Register the Markdown Clipboard module
        Quill.register('modules/clipboard', MarkdownClipboard);

        // Define custom icons
        const icons = Quill.import('ui/icons');
        icons['divider'] = '<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2"/></svg>';
        icons['showHtml'] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
        icons['showMarkdown'] = '<svg viewBox="0 0 128 128" fill="currentColor"><path d="M12 24.3c-5.8 0-10.6 4.9-10.6 10.7v57.9c0 5.8 4.8 10.7 10.6 10.7h104.1c5.8 0 10.6-4.9 10.6-10.7V35c0-5.8-4.8-10.7-10.6-10.7H12zm0 9.5h104.1c.6 0 1.1.4 1.1 1.1v57.9c0 .7-.5 1.1-1.1 1.1H12c-.6 0-1.1-.4-1.1-1.1V35c0-.7.5-1.1 1.1-1.1z"/><path d="M20.7 84.1V43.9h11.7l11.7 14.8 11.7-14.8h11.7v40.2H55.8V61l-11.7 14.8-11.7-14.8V84.1H20.7zm73.1 0L76.3 64.6h11.7V43.9h11.7v20.7h11.7z"/></svg>';
        icons['increaseFontSize'] = '<svg viewBox="0 0 18 18" stroke="currentColor" stroke-width="2"><line x1="9" y1="5" x2="9" y2="13"/><line x1="5" y1="9" x2="13" y2="9"/></svg>';
        icons['decreaseFontSize'] = '<svg viewBox="0 0 18 18" stroke="currentColor" stroke-width="2"><line x1="5" y1="9" x2="13" y2="9"/></svg>';
        icons['runLlm'] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        icons['accept'] = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        icons['reject'] = '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    }

    registerCustomQuillFeatures();

    class QuillHandler {
        // Configuration constants
        static API_REVISE_STREAM = '/inline_llm_revise_stream';
        static API_CONTINUE_STREAM = '/inline_llm_continue_stream';
        static FONT_SIZE_KEY = 'quill-font-size';
        static MIN_FONT_SIZE = 10;
        static MAX_FONT_SIZE = 30;
        static FONT_STEP = 1;

        constructor(editorId) {
            this.editorId = editorId;
            this.editorNode = document.getElementById(editorId);
            this.hiddenInput = document.getElementById(`${editorId}-hidden`);
            if (!this.editorNode || !this.hiddenInput) {
                console.error(`Editor or hidden input not found for ID: ${editorId}`);
                return;
            }

            // State management
            this.llmSuggestionRange = null;
            this.abortController = null;
            this.actionBeats = this.loadActionBeats();

            this.quill = this.initializeEditor();

            // Store the Quill instance on the DOM element for easy access, similar to jQuery's .data()
            this.editorNode.quill = this.quill;
            // Also store the handler instance itself for access to its methods
            this.editorNode.quillHandler = this;

            this.loadInitialContent();
            this.loadFontSize();
            this.initializeStats();
            this.updateHiddenInput(); // Set initial state
            this.updateStats();
        }

        debounce(func, wait) {
            let timeout;
            return function(...args) {
                const context = this;
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(context, args), wait);
            };
        }

        initializeEditor() {
            const quill = new Quill(this.editorNode, {
                theme: 'snow',
                modules: {
                    toolbar: {
                        container: [
                            [{ 'header': [1, 2, 3, false] }],
                            ['bold', 'italic', 'underline'],
                            [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                            ['divider'],
                            ['runLlm', 'accept', 'reject'],
                            ['showHtml', 'showMarkdown'],
                            ['increaseFontSize', 'decreaseFontSize'],
                            ['clean']
                        ],
                        handlers: this.getToolbarHandlers()
                    },
                    toggleFullscreen: true,
                    clipboard: true
                },
                formats: ['bold', 'italic', 'underline', 'strike', 'blockquote', 'header', 'list', 'link', 'highlight', 'divider']
            });

            // Add text-change event listener
            quill.on('text-change', (delta, oldDelta, source) => {
                if (source === Quill.sources.USER) {
                    this.updateHiddenInput();
                    this.debouncedUpdateStats();
                }
            });

            // Add keydown event listener
            quill.root.addEventListener('keydown', this.handleKeyDown.bind(this));

            this.debouncedUpdateStats = this.debounce(this.updateStats, 250);

            return quill;
        }

        initializeStats() {
            const toolbar = this.quill.getModule('toolbar');
            const container = toolbar.container;
            const statsContainer = document.createElement('span');
            statsContainer.classList.add('ql-formats', 'ql-stats-container');
            statsContainer.innerHTML = `
                <span class="ql-stat">W: <span class="ql-stat-value" id="${this.editorId}-word-count">0</span></span>
                <span class="ql-stat">C: <span class="ql-stat-value" id="${this.editorId}-char-count">0</span></span>
                <span class="ql-stat">S: <span class="ql-stat-value" id="${this.editorId}-sentence-count">0</span></span>
            `;
            container.appendChild(statsContainer);
        }

        getToolbarHandlers() {
            return {
                'divider': () => {
                    const range = this.quill.getSelection(true);
                    this.quill.insertEmbed(range.index, 'divider', true, Quill.sources.USER);
                    this.quill.setSelection(range.index + 1, 0, Quill.sources.USER);
                },
                'showHtml': () => {
                    let html = this.quill.getSemanticHTML().replace(/(\u00A0|&nbsp;)/g, ' ');
                    html = html.replace(/<(p|h1|h2|h3|ol|ul|li|blockquote|pre|hr)/g, '\n<$1').trim();
                    showModalWithContent('Raw HTML', html);
                },
                'showMarkdown': () => {
                    const markdown = this.hiddenInput.value;
                    showModalWithContent('Markdown', markdown);
                },
                'increaseFontSize': () => this.adjustFontSize(QuillHandler.FONT_STEP),
                'decreaseFontSize': () => this.adjustFontSize(-QuillHandler.FONT_STEP),
                'runLlm': () => this.runLlm(),
                'accept': () => this.acceptLlmSuggestion(),
                'reject': () => this.rejectLlmSuggestion(),
                'clean': () => this.cleanHighlightFormatting()
            };
        }

        updateStats() {
            const text = this.quill.getText();
            const stats = this.calculateTextStats(text);
            document.getElementById(`${this.editorId}-word-count`).innerText = stats.wordCount;
            document.getElementById(`${this.editorId}-char-count`).innerText = stats.charCount;
            document.getElementById(`${this.editorId}-sentence-count`).innerText = stats.sentenceCount;
        }

        /**
         * Calculates various text statistics for a given string of content.
         *
         * @param {string} content The text content to analyze.
         * @returns {{wordCount: number, charCount: number, sentenceCount: number}} An object containing the word count, character count, and sentence count.
         */
        calculateTextStats(content) {
            /**
             * The `\p{...}` syntax in the regex below is a Unicode property escape.
             * It allows matching characters based on properties, like being a "Letter" or "Number",
             * which makes the logic work for many different languages and scripts.
             * The 'u' flag on the regex is required to enable this.
             *
             * Key escapes used:
             * - \p{L}: Any Unicode letter (e.g., a, Å, α).
             * - \p{N}: Any Unicode number (e.g., 1, ٣).
             * - \p{Lu}: Any uppercase Unicode letter (e.g., A, B, C).
             */

            if (typeof content !== 'string' || content.length === 0) {
                return { wordCount: 0, charCount: 0, sentenceCount: 0 };
            }

            // --- Character Counts ---

            // Counts characters after removing all line breaks.
            const charCount = content.replace(/[\r\n]+/g, '').length;

            /**
             * Word Count (`wordCount`):
             * Splits text by whitespace, then counts only the segments that contain at least one
             * Unicode letter (`\p{L}`) or number (`\p{N}`). This correctly filters out items
             * that consist only of punctuation.
             */
            const words = content
                .trim()
                .split(/\s+/)
                .filter(w => /\p{L}|\p{N}/u.test(w));
            const wordCount = words.length;

            /**
             * Sentence Count (`sentenceCount`):
             * Splits text by matching the boundary between sentences. The regex uses a lookbehind
             * and lookahead to find sentence-ending punctuation (. ! ?) followed by whitespace
             * and a new sentence that must start with a Unicode uppercase letter (`\p{Lu}`) or a number (`\p{N}`).
             */
            const normalizedContent = content.replace(/[\r\n]+/g, ' ');
            const sentenceSplitRegex = new RegExp(
                `(?<=[.!?])` +      // Preceded by sentence-ending punctuation.
                `\\s+` +            // Match the whitespace separator.
                `(?=[\\p{Lu}\\p{N}])`, // Followed by a Unicode uppercase letter or number.
                'gu'
            );

            const sentences = normalizedContent
                .split(sentenceSplitRegex)
                .map(s => s.trim())
                .filter(s => s.length > 0);
            const sentenceCount = sentences.length > 0 ? sentences.length : (content.trim().length > 0 ? 1 : 0);


            return { wordCount, charCount, sentenceCount };
        }

        handleKeyDown(e) {
            const keyMap = {
                '\\': this.runLlm,
                '=': this.acceptLlmSuggestion,
                'Escape': this.rejectLlmSuggestion
            };

            if (keyMap[e.key]) {
                e.preventDefault();
                keyMap[e.key].call(this);
            }
        }     
        
        // --- LLM Handling ---

        async runLlm() {
            this.rejectLlmSuggestion(); // Clear any previous state

            const range = this.quill.getSelection() || { index: this.quill.getLength(), length: 0 };
            const isSelection = range.length > 0;
            
            const apiUrl = isSelection ? QuillHandler.API_REVISE_STREAM : QuillHandler.API_CONTINUE_STREAM;
            const context = isSelection ? this.quill.getText(range.index, range.length) : this.quill.getText(0, range.index);
            
            let insertAt = range.index + range.length;
            if (isSelection) {
                this.quill.insertText(insertAt, ' ', Quill.sources.USER); // Add space after selection
                insertAt += 1;
            }

            this.llmSuggestionRange = { index: insertAt, length: 0 };
            this.abortController = new AbortController();

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ context, action_beats: this.actionBeats }),
                    signal: this.abortController.signal
                });

                if (!response.body) throw new Error('ReadableStream not available.');

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonString = line.substring(6);
                            if (!jsonString) continue;

                            try {
                                const data = JSON.parse(jsonString);
                                if (data.content === '[DONE]') return;
                                if (data.content) {
                                    this.quill.insertText(insertAt, data.content, 'highlight', true, Quill.sources.API);
                                    this.llmSuggestionRange.length += data.content.length;
                                    insertAt += data.content.length;
                                    this.quill.setSelection(insertAt, 0, Quill.sources.API);
                                }
                            } catch (e) {
                                console.error('Error parsing stream data:', e);
                            }
                        }
                    }
                }
            } catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Error fetching LLM stream:', error);
                }
            } finally {
                this.abortController = null;
            }
        }

        acceptLlmSuggestion() {
            if (this.llmSuggestionRange) {
                this.quill.formatText(
                    this.llmSuggestionRange.index,
                    this.llmSuggestionRange.length,
                    'highlight', false, Quill.sources.API
                );
                this.quill.setSelection(this.llmSuggestionRange.index + this.llmSuggestionRange.length, 0, Quill.sources.USER);
                this.llmSuggestionRange = null;
            }
        }

        rejectLlmSuggestion() {
            if (this.abortController) {
                this.abortController.abort();
            }
            if (this.llmSuggestionRange) {
                const originalIndex = this.llmSuggestionRange.index;
                this.quill.deleteText(this.llmSuggestionRange.index, this.llmSuggestionRange.length, Quill.sources.API);
                this.llmSuggestionRange = null;
                this.quill.setSelection(originalIndex, 0, Quill.sources.USER);
            }
        }

        // --- Formatting & Content ---

        cleanHighlightFormatting() {
            const delta = this.quill.getContents();
            const newOps = delta.ops.map(op => {
                if (op.attributes && op.attributes.highlight) {
                    delete op.attributes.highlight;
                    if (Object.keys(op.attributes).length === 0) {
                        op.attributes = undefined;
                    }
                }
                return op;
            });
            this.quill.setContents(newOps, Quill.sources.API);
        }

        updateHiddenInput() {
            const semanticHTML = this.quill.getSemanticHTML().replace(/(\u00A0|&nbsp;)/g, ' ');
            // use turndown to convert HTML to Markdown
            this.hiddenInput.value = turndownService.turndown(semanticHTML);
        }

        loadInitialContent() {
            const initialContentJSON = this.hiddenInput.dataset.initialContent;
            if (initialContentJSON) {
                try {
                    const markdownContent = JSON.parse(initialContentJSON);
                    this.updateEditorWithMarkdown(markdownContent);
                } catch (e) {
                    console.error('Error parsing initial content:', e);
                    this.quill.clipboard.dangerouslyPasteHTML(initialContentJSON);
                }
            }
        }

        loadActionBeats() {
            const actionBeatsJSON = this.hiddenInput.dataset.actionBeats;
            if (actionBeatsJSON) {
                try {
                    return JSON.parse(actionBeatsJSON);
                } catch (e) {
                    console.error('Error parsing action beats:', e);
                    return '';
                }
            }
            return '';
        }

        updateEditorWithHtml(html, user = "api") {            
            this.quill.clipboard.dangerouslyPasteHTML(html);

            // Scroll to bottom to follow updates
            this.quill.setSelection(this.quill.getLength(), 0, user);

            // Make sure to update the hidden input as well
            this.updateHiddenInput();
        }

        updateEditorWithMarkdown(markdownContent, user = "api") {
            // use showdown to convert Markdown to HTML
            const html = showdownConverter.makeHtml(markdownContent);
            this.updateEditorWithHtml(html, user);
        }

        // --- Font Size ---

        adjustFontSize(step) {
            const editor = this.quill.container.querySelector('.ql-editor');
            let currentSize = parseInt(editor.style.getPropertyValue('--quill-font-size'), 10) || 16;
            const newSize = Math.max(QuillHandler.MIN_FONT_SIZE, Math.min(QuillHandler.MAX_FONT_SIZE, currentSize + step));
            editor.style.setProperty('--quill-font-size', `${newSize}px`);
            localStorage.setItem(QuillHandler.FONT_SIZE_KEY, newSize);
        }

        loadFontSize() {
            const savedSize = localStorage.getItem(QuillHandler.FONT_SIZE_KEY);
            if (savedSize) {
                const editor = this.quill.container.querySelector('.ql-editor');
                editor.style.setProperty('--quill-font-size', `${savedSize}px`);
            }
        }        
    }
 
    // Initialize all Quill editors on the page
    document.querySelectorAll('.quill-editor').forEach(editorNode => {
        // The QuillHandler constructor now attaches the instance to the editorNode.
        new QuillHandler(editorNode.id);
    });
});