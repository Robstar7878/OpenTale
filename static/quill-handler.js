$(document).ready(function() {
    // Initialize converters
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

    const Inline = Quill.import('blots/inline');
    const BlockEmbed = Quill.import('blots/block/embed');

    // 1. Define Custom Blots
    // HighlightBlot: <mark class="highlight-text">
    class HighlightBlot extends Inline {}
    HighlightBlot.blotName = 'highlight';
    HighlightBlot.tagName = 'mark';
    HighlightBlot.className = 'highlight-text';

    // NoteBlot: <mark>
    class NoteBlot extends Inline {
        static create(value) {
            let node = super.create();
            node.setAttribute('class', 'bg-primary text-primary-content');
            return node;
        }
        
        static formats(node) {
            return node.getAttribute('class').split(' ');
        }
}
    NoteBlot.blotName = 'note';
    NoteBlot.tagName = 'mark';

    // DividerBlot: <hr>
    class DividerBlot extends BlockEmbed {}
    DividerBlot.blotName = 'divider';
    DividerBlot.tagName = 'hr';

    // Register the custom blots with Quill
    Quill.register(HighlightBlot);
    Quill.register(NoteBlot);
    Quill.register(DividerBlot);

    // 2. Add cleaning methods
    /**
     * Removes all 'mark' tag formatting (highlights and notes) but keeps the text.
     * @param {Quill} quill The Quill instance.
     */
    window.cleanEditorMarks = function(quill) {
        const delta = quill.getContents();
        const newOps = delta.ops.map(op => {
            if (op.attributes && (op.attributes.highlight || op.attributes.note)) {
                const { highlight, note, ...rest } = op.attributes;
                op.attributes = Object.keys(rest).length > 0 ? rest : undefined;
            }
            return op;
        });
        quill.setContents(newOps, 'api');
    };

    /**
     * Removes all 'mark' tags and the content within them.
     * @param {Quill} quill The Quill instance.
     */
    window.cleanEditorMarksAndContent = function(quill) {
        const delta = quill.getContents();
        const newOps = delta.ops.filter(op =>
            !op.attributes || (!op.attributes.highlight && !op.attributes.note)
        );
        quill.setContents(newOps, 'api');
    };

    /**
     * Updates the hidden input with the current editor content in Markdown.
     * @param {Quill} quill The Quill instance.
     */
    window.updateHiddenInput = function(quill) {
        const editorId = quill.container.id;
        const hiddenInput = $(`#${editorId}-hidden`);
        const semanticHTML = quill.getSemanticHTML().replace(/(\u00A0|&nbsp;)/g, ' ');
        hiddenInput.val(turndownService.turndown(semanticHTML));
    };

    /**
     * Initializes a Quill editor with custom blots.
     * @param {string} editorId The ID of the editor container.
     * @param {jQuery} hiddenInput The jQuery object for the hidden input field.
     * @returns {Quill} The initialized Quill instance.
     */
    // Define custom icons
    const icons = Quill.import('ui/icons');
    icons['divider'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    icons['showHtml'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
    icons['showMarkdown'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM9.5 16.5H7.5v-6h2v6zm4-6h-2v6h2v-2.5l2 2.5v-6l-2 2.5V10.5z"/></svg>';
    icons['increaseFontSize'] = '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="9" y1="5" x2="9" y2="13"></line><line class="ql-stroke" x1="5" y1="9" x2="13" y2="9"></line></svg>';
    icons['decreaseFontSize'] = '<svg viewBox="0 0 18 18"><line class="ql-stroke" x1="5" y1="9" x2="13" y2="9"></line></svg>';
    icons['runLlm'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    icons['accept'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    icons['reject'] = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

    function initializeEditor(editorId, hiddenInput) {
        const FONT_SIZE_KEY = 'quill-font-size';
        const MIN_FONT_SIZE = 10;
        const MAX_FONT_SIZE = 30;
        const FONT_STEP = 1;

        let lastLlmRange = null;
        let currentCarotRange = null;
        let llmInsertedRange = null;
        let abortController = null;

        /**
         * Displays a caret '|>' at a specific position or end of the editor.
         * @param {Quill} quill The Quill instance.
         * @param {number} [insertAt] The index to insert the caret. Defaults to end of document.
         */
        window.showCarot = function(quill, insertAt) {
            if (insertAt === undefined || insertAt === null) {
                const range = quill.getSelection() || { index: quill.getLength(), length: 0 };
                insertAt = range.index + range.length;
            }
            const caretText = '|>';
            quill.insertText(insertAt, caretText, 'api');
            currentCarotRange = { index: insertAt, length: caretText.length };
            quill.setSelection(insertAt + caretText.length, 0, 'api');
        };

        /**
         * Hides the previously displayed caret '|>'.
         * @param {Quill} quill The Quill instance.
         */
        window.hideCarot = function(quill) {
            if (currentCarotRange) {
                quill.deleteText(currentCarotRange.index, currentCarotRange.length, 'api');
                currentCarotRange = null;
            }
        };

        const quill = new Quill(`#${editorId}`, {
            theme: 'snow',
            modules: {
                toolbar: {
                    container: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['divider'],
                        ['runLlm', 'accept', 'reject'],
                        ['showHtml', 'showMarkdown'],
                        ['increaseFontSize', 'decreaseFontSize'],
                        ['clean']
                    ],
                    handlers: {
                        'divider': function() {
                            const range = this.quill.getSelection(true);
                            this.quill.insertEmbed(range.index, 'divider', true, 'user');
                            this.quill.setSelection(range.index + 1, 0, 'user');
                        },
                        'showHtml': function() {
                            let html = this.quill.getSemanticHTML().replace(/(\u00A0|&nbsp;)/g, ' ');
                            html = html.replace(/<(p|h1|h2|h3|ol|ul|li|blockquote|pre|hr)/g, '\n<$1').trim();
                            showModalWithContent('Raw HTML', html);
                        },
                        'showMarkdown': function() {
                            const markdown = hiddenInput.val();
                            showModalWithContent('Markdown', markdown);
                        },
                        'increaseFontSize': function() {
                            const editor = this.quill.container.querySelector('.ql-editor');
                            let currentSize = parseInt(window.getComputedStyle(editor).getPropertyValue('--quill-font-size'), 10) || 16;
                            if (currentSize < MAX_FONT_SIZE) {
                                const newSize = currentSize + FONT_STEP;
                                editor.style.setProperty('--quill-font-size', `${newSize}px`);
                                localStorage.setItem(FONT_SIZE_KEY, newSize);
                            }
                        },
                        'decreaseFontSize': function() {
                            const editor = this.quill.container.querySelector('.ql-editor');
                            let currentSize = parseInt(window.getComputedStyle(editor).getPropertyValue('--quill-font-size'), 10) || 16;
                            if (currentSize > MIN_FONT_SIZE) {
                                const newSize = currentSize - FONT_STEP;
                                editor.style.setProperty('--quill-font-size', `${newSize}px`);
                                localStorage.setItem(FONT_SIZE_KEY, newSize);
                            }
                        },
                        'runLlm': async function() {
                            const quill = this.quill;

                            // Reset any existing LLM state by calling the reject handler.
                            this.handlers.reject.call(this);

                            lastLlmRange = quill.getSelection() || { index: quill.getLength(), length: 0 };
                            const range = lastLlmRange;
                            let context = '';
                            let insertAt = range.index;
                            let llm_api = '';

                            if (range.length > 0) {
                                llm_api = '/inline_llm_revise_stream';
                                context = quill.getText(range.index, range.length);
                                insertAt = range.index + range.length;
                                quill.insertText(insertAt, ' ', 'user');
                                insertAt += 1;
                            } else {
                                llm_api = '/inline_llm_continue_stream';
                                window.cleanEditorMarksAndContent(quill);
                                context = quill.getText(0, range.index);
                                insertAt = range.index;
                            }
                            
                            window.showCarot(quill, insertAt);

                            let llmInsertAt = insertAt + 2;
                            llmInsertedRange = { index: insertAt, length: 2 };

                            abortController = new AbortController();
                            const signal = abortController.signal;

                            try {
                                const response = await fetch(llm_api, {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                    },
                                    body: JSON.stringify({ context: context }),
                                    signal: signal
                                });

                                if (!response.body) {
                                    throw new Error('ReadableStream not available');
                                }

                                const reader = response.body.getReader();
                                const decoder = new TextDecoder();
                                let buffer = '';

                                while (true) {
                                    const { done, value } = await reader.read();
                                    if (done) {
                                        break;
                                    }

                                    buffer += decoder.decode(value, { stream: true });
                                    const lines = buffer.split('\n');
                                    buffer = lines.pop(); // Keep the last, possibly incomplete, line

                                    for (const line of lines) {
                                        if (line.startsWith('data: ')) {
                                            const jsonString = line.substring(6);
                                            if (jsonString) {
                                                try {
                                                    const data = JSON.parse(jsonString);
                                                    if (data.content === '[DONE]') {
                                                        return;
                                                    }
                                                    
                                                    if (data.content) {
                                                        quill.insertText(llmInsertAt, data.content, 'highlight', true, 'api');
                                                        llmInsertedRange.length += data.content.length;
                                                        llmInsertAt += data.content.length;
                                                        quill.setSelection(llmInsertAt, 0, 'api');
                                                    }
                                                } catch (e) {
                                                    console.error('Error parsing stream data:', e);
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (error) {
                                if (error.name === 'AbortError') {
                                    console.log('LLM stream aborted by user.');
                                } else {
                                    console.error('Error fetching LLM stream:', error);
                                }
                            } finally {
                                abortController = null;
                            }
                        },
                        'accept': function() {
                            const quill = this.quill;
                            if (currentCarotRange) {
                                quill.deleteText(currentCarotRange.index, currentCarotRange.length, 'api');
                                if (llmInsertedRange) {
                                    llmInsertedRange.index = currentCarotRange.index;
                                    llmInsertedRange.length -= currentCarotRange.length;
                                }
                                currentCarotRange = null;
                            }
                            window.cleanEditorMarks(quill);
                            llmInsertedRange = null;
                        },
                        'reject': function() {
                            const quill = this.quill;
                            if (abortController) {
                                abortController.abort();
                                abortController = null;
                            }
                            
                            if (llmInsertedRange) {
                                const originalIndex = llmInsertedRange.index;
                                quill.deleteText(llmInsertedRange.index, llmInsertedRange.length, 'api');
                                quill.setSelection(originalIndex, 0, 'user');
                                llmInsertedRange = null;
                                currentCarotRange = null;
                            } else {
                                window.hideCarot(quill);
                                if (lastLlmRange) {
                                    quill.setSelection(lastLlmRange.index, 0, 'user');
                                }
                            }
                        }
                    }
                }
            },
            formats: ['bold', 'italic', 'underline', 'strike', 'blockquote', 'header', 'list', 'link', 'highlight', 'note', 'divider'],
        });

        // Add custom keydown event listener for hotkeys
        quill.root.addEventListener('keydown', function(e) {
            const toolbar = quill.getModule('toolbar');
            if (e.key === '\\') {
                e.preventDefault();
                toolbar.handlers.runLlm.call(toolbar);
            } else if (e.key === '=') {
                e.preventDefault();
                toolbar.handlers.accept.call(toolbar);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                toolbar.handlers.reject.call(toolbar);
            }
        });

        // Load saved font size
        const savedSize = localStorage.getItem(FONT_SIZE_KEY);
        if (savedSize) {
            quill.container.querySelector('.ql-editor').style.setProperty('--quill-font-size', `${savedSize}px`);
        }

        // Load initial content from the data attribute
        const initialContentJSON = hiddenInput.data('initial-content');
        if (initialContentJSON) {
            try {
                // The content is passed as a JSON string (potentially Markdown), so parse it.
                const markdownContent = JSON.parse(initialContentJSON);
                // Convert Markdown to HTML
                const html = showdownConverter.makeHtml(markdownContent);
                // Load the converted HTML into Quill
                quill.clipboard.dangerouslyPasteHTML(html);
            } catch (e) {
                console.error('Error parsing or converting initial content for Quill editor:', e);
                // Fallback to raw content if parsing fails
                quill.clipboard.dangerouslyPasteHTML(initialContentJSON);
            }
        }

        // **Crucially, set the hidden input's value immediately after initialization**
        // This ensures that if the user saves without making changes, the original content is preserved.
        window.updateHiddenInput(quill);

        // Update hidden input whenever the user makes a change
        quill.on('text-change', function(delta, oldDelta, source) {
            if (source === 'user') {
                window.updateHiddenInput(quill);
            }
        });
        
        return quill;
    }

    // Find all Quill editor containers and initialize them
    $('.quill-editor').each(function() {
        const editorId = $(this).attr('id');
        const hiddenInput = $(`#${editorId}-hidden`);
        const quill = initializeEditor(editorId, hiddenInput);

        // Store the Quill instance in the element for later use
        $(this).data('quill', quill);
    });
});