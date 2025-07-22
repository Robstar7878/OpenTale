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
        simplifiedAutoLink: true
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

        // Define custom icons
        const icons = Quill.import('ui/icons');
        icons['divider'] = '<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" /></svg>';
        icons['showHtml'] = '<svg viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6" stroke="currentColor" fill="none" stroke-width="2" /><polyline points="8 6 2 12 8 18" stroke="currentColor" fill="none" stroke-width="2" /></svg>';
        icons['showMarkdown'] = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2zM9.5 16.5H7.5v-6h2v6zm4-6h-2v6h2v-2.5l2 2.5v-6l-2 2.5V10.5z"/></svg>';
        icons['increaseFontSize'] = '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="9" y1="5" x2="9" y2="13"></line><line class="ql-stroke" x1="5" y1="9" x2="13" y2="9"></line></svg>';
        icons['decreaseFontSize'] = '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="5" y1="9" x2="13" y2="9"></line></svg>';
        icons['runLlm'] = '<svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" stroke="currentColor" fill="none" stroke-width="2" /></svg>';
        icons['accept'] = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" stroke="currentColor" fill="none" stroke-width="2" /></svg>';
        icons['reject'] = '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" /><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" /></svg>';
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

            this.quill = this.initializeEditor();
            this.loadInitialContent();
            this.loadFontSize();
            this.updateHiddenInput(); // Set initial state
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
                    }
                },
                formats: ['bold', 'italic', 'underline', 'strike', 'blockquote', 'header', 'list', 'link', 'highlight', 'divider']
            });

            // Add event listeners
            quill.on('text-change', (delta, oldDelta, source) => {
                if (source === 'user') {
                    this.updateHiddenInput();
                }
            });

            quill.root.addEventListener('keydown', this.handleKeyDown.bind(this));

            return quill;
        }

        getToolbarHandlers() {
            return {
                'divider': () => {
                    const range = this.quill.getSelection(true);
                    this.quill.insertEmbed(range.index, 'divider', true, 'user');
                    this.quill.setSelection(range.index + 1, 0, 'user');
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
                this.quill.insertText(insertAt, ' ', 'user'); // Add space after selection
                insertAt += 1;
            }

            this.llmSuggestionRange = { index: insertAt, length: 0 };
            this.abortController = new AbortController();

            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ context }),
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
                                    this.quill.insertText(insertAt, data.content, 'highlight', true, 'api');
                                    this.llmSuggestionRange.length += data.content.length;
                                    insertAt += data.content.length;
                                    this.quill.setSelection(insertAt, 0, 'api');
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
                    'highlight', false, 'api'
                );
                this.quill.setSelection(this.llmSuggestionRange.index + this.llmSuggestionRange.length, 0, 'user');
                this.llmSuggestionRange = null;
            }
        }

        rejectLlmSuggestion() {
            if (this.abortController) {
                this.abortController.abort();
            }
            if (this.llmSuggestionRange) {
                const originalIndex = this.llmSuggestionRange.index;
                this.quill.deleteText(this.llmSuggestionRange.index, this.llmSuggestionRange.length, 'api');
                this.llmSuggestionRange = null;
                this.quill.setSelection(originalIndex, 0, 'user');
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
            this.quill.setContents(newOps, 'api');
        }

        updateHiddenInput() {
            const semanticHTML = this.quill.getSemanticHTML().replace(/(\u00A0|&nbsp;)/g, ' ');
            this.hiddenInput.value = turndownService.turndown(semanticHTML);
        }

        loadInitialContent() {
            const initialContentJSON = this.hiddenInput.dataset.initialContent;
            if (initialContentJSON) {
                try {
                    const markdownContent = JSON.parse(initialContentJSON);
                    const html = showdownConverter.makeHtml(markdownContent);
                    this.quill.clipboard.dangerouslyPasteHTML(html);
                } catch (e) {
                    console.error('Error parsing initial content:', e);
                    this.quill.clipboard.dangerouslyPasteHTML(initialContentJSON);
                }
            }
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
        // Store the instance on the DOM element for potential external access
        editorNode.quillHandler = new QuillHandler(editorNode.id);
    });
});