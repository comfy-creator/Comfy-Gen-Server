import { ComfyLogging } from './logging';
import {ComfyWidgets} from './widgets';
import { ComfyUI, $el } from './ui';
import { ComfyApi } from './api';
import { defaultGraph } from './defaultGraph';
import { getPngMetadata, getWebpMetadata, importA1111, getLatentMetadata } from './pnginfo';
import { addDomClippingSetting } from './domWidget';
import { LiteGraph } from 'litegraph.js';
import { ComfyCanvas } from './comfyCanvas';
import { ComfyGraph } from './comfyGraph';
import { ComfyNode } from './comfyNode';
import {
    ComfyError,
    ComfyFile,
    ComfyNodeError,
    ComfyProgress,
    ComfyPromptError,
    ComfyWidget,
    QueueItem,
    SerializedNodeObject,
    TemplateData,
    WorkflowStep,
} from '../types/many';
import { ComfyExtension } from '../types/comfy';
import { ComfyObjectInfo } from '../types/comfy';

export const ANIM_PREVIEW_WIDGET = '$$comfy_animation_preview';

function sanitizeNodeName(string: string) {
    let entityMap = {
        '&': '',
        '<': '',
        '>': '',
        '"': '',
        "'": '',
        '`': '',
        '=': '',
    };

    return String(string).replace(/[&<>"'`=]/g, function fromEntityMap(s) {
        return entityMap[s as keyof typeof entityMap];
    });
}

export class ComfyApp {
    /**
     * List of entries to queue
     */
    #queueItems: QueueItem[] = [];

    /**
     * If the queue is currently being processed
     */
    #processingQueue: boolean = false;

    /**
     * Content Clipboard
     */
    static clipspace: SerializedNodeObject | null = null;
    static clipspace_invalidate_handler: (() => void) | null = null;
    static open_maskeditor: (() => void) | null = null;
    static clipspace_return_node = null;

    /** The UI manager for the app */
    ui: ComfyUI;

    /** The logging manager for the app */
    logging: ComfyLogging;

    /** List of extensions that are registered with the app */
    extensions: ComfyExtension[] = [];

    /**
     * Stores the execution output data for each node
     */
    nodeOutputs: Record<string, any> = {};

    /**
     * Stores the preview image data for each node
     */
    nodePreviewImages: Record<string, HTMLImageElement | string[]> = {};

    /**
     * Indicates if the shift key on the keyboard is pressed
     */
    shiftDown: boolean = false;

    api: ComfyApi;

    /**
     * The canvas element associated with the app, if any
     */
    canvasEl: (HTMLCanvasElement & { id: string }) | null = null;
    canvas: ComfyCanvas | null = null;
    graph: ComfyGraph | null = null;
    ctx: CanvasRenderingContext2D | null = null;
    saveInterval: NodeJS.Timeout | null = null;

    // This makes it possible to cleanup a ComfyApp instance's listeners
    private abortController: AbortController = new AbortController();

    dragOverNode?: ComfyNode | null;

    widgets: ComfyWidgets | null = null;

    progress: ComfyProgress | null = null;
    runningNodeId: number | null = null;
    lastExecutionError: { node_id: number; message: string } | null = null;
    lastNodeErrors: Record<string, ComfyNodeError> | null = null;
    configuringGraph: boolean = false;
    isNewUserSession: boolean = false;
    storageLocation: string | null = null;
    multiUserServer: boolean = false;

    constructor() {
        this.api = new ComfyApi();
        this.ui = new ComfyUI(this);
        this.logging = new ComfyLogging(this);
    }

    getPreviewFormatParam() {
        let preview_format = this.ui.settings.getSettingValue('Comfy.PreviewFormat');
        if (preview_format) return `&preview=${preview_format}`;
        else return '';
    }

    getRandParam() {
        return '&rand=' + Math.random();
    }

    static isImageNode(node: ComfyNode) {
        return node.imgs || (node && node.widgets && node.widgets.findIndex(obj => obj.name === 'image') >= 0);
    }

    onClipspaceEditorSave() {
        if (ComfyApp.clipspace_return_node) {
            this.pasteFromClipspace(ComfyApp.clipspace_return_node);
        }
    }

    static onClipspaceEditorClosed() {
        ComfyApp.clipspace_return_node = null;
    }

    static copyToClipspace(node: ComfyNode) {
        let widgets = null;
        if (node.widgets) {
            widgets = node.widgets.map(({ type, name, value }) => ({
                type,
                name,
                value,
            })) as ComfyWidget[];
        }

        let imgs = undefined;
        let orig_imgs = undefined;
        if (node.imgs != undefined) {
            imgs = [];
            orig_imgs = [];

            for (let i = 0; i < node.imgs.length; i++) {
                imgs[i] = new Image();
                imgs[i].src = (node.imgs[i] as HTMLImageElement).src;
                orig_imgs[i] = imgs[i];
            }
        }

        let selectedIndex = 0;
        if (node.imageIndex) {
            selectedIndex = node.imageIndex;
        }

        ComfyApp.clipspace = {
            widgets: widgets,
            imgs: imgs,
            original_imgs: orig_imgs,
            images: node.images,
            selectedIndex: selectedIndex,
            img_paste_mode: 'selected', // reset to default im_paste_mode state on copy action
        };

        ComfyApp.clipspace_return_node = null;

        if (ComfyApp.clipspace_invalidate_handler) {
            ComfyApp.clipspace_invalidate_handler();
        }
    }

    pasteFromClipspace(node: ComfyNode) {
        if (ComfyApp.clipspace) {
            // image paste
            if (ComfyApp.clipspace.imgs && node.imgs) {
                if (node.images && ComfyApp.clipspace.images) {
                    if (ComfyApp.clipspace['img_paste_mode'] == 'selected') {
                        node.images = [
                            ComfyApp.clipspace.images[ComfyApp.clipspace['selectedIndex']] as HTMLImageElement,
                        ];
                    } else {
                        node.images = ComfyApp.clipspace.images;
                    }

                    if (this.nodeOutputs[node.id + '']) this.nodeOutputs[node.id + ''].images = node.images;
                }

                if (ComfyApp.clipspace.imgs) {
                    // deep-copy to cut link with clipspace
                    if (ComfyApp.clipspace['img_paste_mode'] == 'selected') {
                        const img = new Image();
                        img.src = (
                            ComfyApp.clipspace.imgs[ComfyApp.clipspace['selectedIndex']] as HTMLImageElement
                        ).src;
                        node.imgs = [img];
                        node.imageIndex = 0;
                    } else {
                        const imgs = [];
                        for (let i = 0; i < ComfyApp.clipspace.imgs.length; i++) {
                            imgs[i] = new Image();
                            imgs[i].src = (ComfyApp.clipspace.imgs[i] as HTMLImageElement).src;
                            node.imgs = imgs;
                        }
                    }
                }
            }

            if (node.widgets) {
                if (ComfyApp.clipspace.images) {
                    const clip_image = ComfyApp.clipspace.images[ComfyApp.clipspace['selectedIndex']] as ComfyFile;
                    const index = node.widgets.findIndex(obj => obj.name === 'image');
                    if (index >= 0) {
                        if (
                            node.widgets[index].type != 'image' &&
                            typeof node.widgets[index].value == 'string' &&
                            clip_image.filename
                        ) {
                            node.widgets[index].value =
                                (clip_image.subfolder ? clip_image.subfolder + '/' : '') +
                                clip_image.filename +
                                (clip_image.type ? ` [${clip_image.type}]` : '');
                        } else {
                            node.widgets[index].value = clip_image;
                        }
                    }
                }
                if (ComfyApp.clipspace.widgets) {
                    ComfyApp.clipspace.widgets.forEach(({ type, name, value }) => {
                        const prop = Object.values(node.widgets).find(obj => obj.type === type && obj.name === name);
                        if (prop && prop.type != 'button') {
                            value = value as ComfyFile;
                            if (prop.type != 'image' && typeof prop.value == 'string' && value.filename) {
                                prop.value =
                                    (value.subfolder ? value.subfolder + '/' : '') +
                                    value.filename +
                                    (value.type ? ` [${value.type}]` : '');
                            } else {
                                prop.value = value;
                                prop.callback(value);
                            }
                        }
                    });
                }
            }

            // TODO: I added false as the second arg but I'm not sure if that's right
            this.graph?.setDirtyCanvas(true, false);
        }
    }

    /**
     * Invoke an extension callback
     * @param {keyof ComfyExtension} method The extension callback to execute
     * @param  {any[]} args Any arguments to pass to the callback
     * @returns
     */
    #invokeExtensions(method: keyof ComfyExtension, ...args: any[]) {
        let results = [];
        for (const ext of this.extensions) {
            if (method in ext) {
                try {
                    results.push((ext[method] as Function)(...args, this));
                } catch (error) {
                    console.error(
                        `Error calling extension '${ext.name}' method '${method}'`,
                        { error },
                        { extension: ext },
                        { args }
                    );
                }
            }
        }
        return results;
    }

    /**
     * Invoke an async extension callback
     * Each callback will be invoked concurrently
     * @param {string} method The extension callback to execute
     * @param  {...any} args Any arguments to pass to the callback
     * @returns
     */
    async invokeExtensionsAsync(method: keyof ComfyExtension | string, ...args: any[]) {
        return await Promise.all(
            this.extensions.map(async ext => {
                if (method in ext) {
                    try {
                        return await (ext[method as keyof ComfyExtension] as Function)(...args, this);
                    } catch (error) {
                        console.error(
                            `Error calling extension '${ext.name}' method '${method}'`,
                            { error },
                            { extension: ext },
                            { args }
                        );
                    }
                }
            })
        );
    }

    /**
     * Adds a handler allowing drag+drop of files onto the window to load workflows
     */
    #addDropHandler() {
        // Get prompt from dropped PNG or json
        document.addEventListener(
            'drop',
            async event => {
                event.preventDefault();
                event.stopPropagation();

                const n = this.dragOverNode;
                this.dragOverNode = null;
                // Node handles file drop, we dont use the built in onDropFile handler as its buggy
                // If you drag multiple files it will call it multiple times with the same file
                if (n && n.onDragDrop && n.onDragDrop(event)) {
                    return;
                }
                // Dragging from Chrome->Firefox there is a file but its a bmp, so ignore that
                if (event.dataTransfer?.files.length && event.dataTransfer.files[0].type !== 'image/bmp') {
                    await this.handleFile(event.dataTransfer.files[0]);
                } else {
                    // Try loading the first URI in the transfer list
                    const validTypes = ['text/uri-list', 'text/x-moz-url'];
                    const match = [...(event.dataTransfer?.types || [])].find(t => validTypes.find(v => t === v));
                    if (match) {
                        const uri = event.dataTransfer?.getData(match)?.split('\n')?.[0];
                        if (uri) {
                            const blob = await (await fetch(uri)).blob();
                            await this.handleFile(new File([blob], ''));
                        }
                    }
                }
            },
            { signal: this.abortController.signal }
        );

        // Always clear over node on drag leave
        this.canvasEl?.addEventListener(
            'dragleave',
            async () => {
                if (this.dragOverNode) {
                    this.dragOverNode = null;
                    this.graph?.setDirtyCanvas(false, true);
                }
            },
            { signal: this.abortController.signal }
        );

        // Add handler for dropping onto a specific node
        this.canvasEl?.addEventListener(
            'dragover',
            e => {
                this.canvas?.adjustMouseEvent(e);
                const node = <ComfyNode | null | undefined>this.graph?.getNodeOnPos(e.canvasX, e.canvasY);
                if (node) {
                    if (node.onDragOver && node.onDragOver(e)) {
                        this.dragOverNode = node;

                        // dragover event is fired very frequently, run this on an animation frame
                        requestAnimationFrame(() => {
                            this.graph?.setDirtyCanvas(false, true);
                        });
                        return;
                    }
                }
                this.dragOverNode = null;
            },
            false
        ), {signal: this.abortController.signal};
    }

    /**
     * Adds a handler on paste that extracts and loads images or workflows from pasted JSON data
     */
    #addPasteHandler() {
        document.addEventListener(
            'paste',
            async e => {
                // ctrl+shift+v is used to paste nodes with connections
                // this is handled by litegraph
                if (this.shiftDown) return;

                let data: DataTransfer | string = e.clipboardData || window.clipboardData;
                const items = data.items;

                // Look for image paste data
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        let imageNode: ComfyNode | null = null;

                        // If an image node is selected, paste into it
                        if (
                            this.canvas?.current_node &&
                            this.canvas?.current_node.is_selected &&
                            ComfyApp.isImageNode(this.canvas.current_node as ComfyNode)
                        ) {
                            imageNode = this.canvas.current_node as ComfyNode;
                        }

                        // No image node selected: add a new one
                        if (!imageNode) {
                            const newNode = <ComfyNode>LiteGraph.createNode('LoadImage');
                            if (this.canvas) {
                                if (this.canvas.graph_mouse) {
                                    newNode.pos = [...this.canvas.graph_mouse];
                                }
                            }

                            // No image node selected: add a new one
                            if (!imageNode) {
                                const newNode = <ComfyNode>LiteGraph.createNode('LoadImage');
                                if (this.canvas) {
                                    newNode.pos = [...this.canvas.graph_mouse];
                                }

                                // imageNode = this.graph?.add(newNode);
                                this.graph?.add(newNode);
                                imageNode = newNode;

                                this.graph?.change();
                            }
                            const blob = item.getAsFile();
                            if (blob) {
                                imageNode?.pasteFile(blob);
                            }
                            return;
                        }
                    }
                }

                // No image found. Look for node data
                data = data.getData('text/plain');
                let workflow;
                try {
                    data = data.slice(data.indexOf('{'));
                    workflow = JSON.parse(data);
                } catch (err) {
                    try {
                        data = data.slice(data.indexOf('workflow\n'));
                        data = data.slice(data.indexOf('{'));
                        workflow = JSON.parse(data);
                    } catch (error) {}
                }

                if (workflow && workflow.version && workflow.nodes && workflow.extra) {
                    await this.loadGraphData(workflow);
                } else {
                    if (e.target?.type === 'text' || e.target?.type === 'textarea') {
                        return;
                    }

                    // Litegraph default paste
                    this.canvas?.pasteFromClipboard();
                }
            },
            { signal: this.abortController.signal }
        );
    }


    /**
     * Adds a handler on copy that serializes selected nodes to JSON
     */
    #addCopyHandler() {
        document.addEventListener(
            'copy',
            e => {
                if (e.target?.type === 'text' || e.target?.type === 'textarea') {
                    // Default system copy
                    return;
                }

                // copy nodes and clear clipboard
                if (e.target?.className === 'litegraph' && this.canvas?.selected_nodes) {
                    this.canvas.copyToClipboard();
                    e.clipboardData?.setData('text', ' '); //clearData doesn't remove images from clipboard
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return false;
                }
            },
            { signal: this.abortController.signal }
        );
    }

    /** Handles updates from the specified API */
    #addApiUpdateHandlers(api: ComfyApi) {
        type EventHandler = (event: Event) => void;
        type EventMap = [string, EventHandler][];

        const eventHandlers: EventMap = [
            [
                'status',
                ({ detail }) => {
                    this.ui.setStatus(detail);
                },
            ],
            [
                'reconnecting',
                () => {
                    this.ui.dialog.show('Reconnecting...');
                },
            ],
            [
                'reconnected',
                () => {
                    this.ui.dialog.close();
                },
            ],
            [
                'progress',
                ({ detail }) => {
                    this.progress = detail;
                    this.graph?.setDirtyCanvas(true, false);
                },
            ],
            [
                'executing',
                ({ detail }) => {
                    this.progress = null;
                    this.runningNodeId = detail;
                    this.graph?.setDirtyCanvas(true, false);
                    if (this.runningNodeId) {
                        delete this.nodePreviewImages[this.runningNodeId];
                    }
                },
            ],
            [
                'executed',
                ({ detail }) => {
                    const output = this.nodeOutputs[detail.node];
                    if (detail.merge && output) {
                        for (const k in detail.output ?? {}) {
                            const v = output[k];
                            if (v instanceof Array) {
                                output[k] = v.concat(detail.output[k]);
                            } else {
                                output[k] = detail.output[k];
                            }
                        }
                    } else {
                        this.nodeOutputs[detail.node] = detail.output;
                    }
                    const node = this.graph?.getNodeById(detail.node);
                    if (node) {
                        if (node.onExecuted) node.onExecuted(detail.output);
                    }
                },
            ],
            [
                'execution_start',
                () => {
                    this.runningNodeId = null;
                    this.lastExecutionError = null;
                    this.graph?.nodes.forEach(node => {
                        let nnode = node as ComfyNode;
                        if (nnode.onExecutionStart) nnode.onExecutionStart();
                    });
                },
            ],
            [
                'execution_error',
                ({ detail }) => {
                    this.lastExecutionError = detail;
                    const formattedError = this.#formatExecutionError(detail);
                    this.ui.dialog.show(formattedError);
                    this.canvas?.draw(true, true);
                },
            ],
            [
                'b_preview',
                ({ detail }) => {
                    const id = this.runningNodeId;
                    if (id == null) return;

                    // const blob = detail;
                    const blobUrl = URL.createObjectURL(detail);
                    this.nodePreviewImages[id] = [blobUrl];
                },
            ],
        ];

        eventHandlers.forEach(
            ([eventName, handler]) => {
                api.addEventListener(eventName, handler);
            },
            { signal: this.abortController.signal }
        );
    }

    #addKeyboardHandler() {
        window.addEventListener(
            'keydown',
            e => {
                this.shiftDown = e.shiftKey;
            },
            { signal: this.abortController.signal }
        );
        window.addEventListener(
            'keyup',
            e => {
                this.shiftDown = e.shiftKey;
            },
            { signal: this.abortController.signal }
        );
    }

    /**
     * Loads all extensions from the API into the window in parallel
     */
    async #loadExtensions() {
        const extensions = <string[]>await this.api.getExtensions();
        this.logging.addEntry('Comfy.App', 'debug', { Extensions: extensions });

        const extensionPromises = extensions.map(async ext => {
            try {
                await import(this.api.apiURL(ext));
            } catch (error) {
                console.error('Error loading extension', ext, error);
            }
        });

        await Promise.all(extensionPromises);
    }

    async #migrateSettings() {
        this.isNewUserSession = true;
        // Store all current settings
        const settings = Object.keys(this.ui.settings).reduce((p: { [x: string]: any }, n) => {
            const v = localStorage[`Comfy.Settings.${n}`];
            if (v) {
                try {
                    p[n] = JSON.parse(v);
                } catch (error) {}
            }
            return p;
        }, {});

        await this.api.storeSettings(settings);
    }

    async #setUser() {
        const userConfig = await this.api.getUserConfig();
        this.storageLocation = userConfig.storage;
        if (typeof userConfig.migrated == 'boolean') {
            // Single user mode migrated true/false for if the default user is created
            if (!userConfig.migrated && this.storageLocation === 'server') {
                // Default user not created yet
                await this.#migrateSettings();
            }
            return;
        }

        this.multiUserServer = true;
        let user = localStorage['Comfy.userId'];
        const users = userConfig.users ?? {};
        if (!user || !users[user]) {
            // This will rarely be hit so move the loading to on demand
            const { UserSelectionScreen } = await import('./ui/userSelection');

            this.ui.menuContainer.style.display = 'none';
            const { userId, username, created } = await new UserSelectionScreen().show(users, user);
            this.ui.menuContainer.style.display = '';

            user = userId;
            localStorage['Comfy.userName'] = username;
            localStorage['Comfy.userId'] = user;

            if (created) {
                this.api.user = user;
                await this.#migrateSettings();
            }
        }

        this.api.user = user;

        this.ui.settings.addSetting({
            id: 'Comfy.SwitchUser',
            name: 'Switch User',
            defaultValue: 'any',
            onChange: 'any',
            type: (name: string) => {
                let currentUser = localStorage['Comfy.userName'];
                if (currentUser) {
                    currentUser = ` (${currentUser})`;
                }
                return $el('tr', [
                    $el('td', [
                        $el('label', {
                            textContent: name,
                        }),
                    ]),
                    $el('td', [
                        $el('button', {
                            textContent: name + (currentUser ?? ''),
                            onclick: () => {
                                delete localStorage['Comfy.userId'];
                                delete localStorage['Comfy.userName'];
                                window.location.reload();
                            },
                        }),
                    ]),
                ]);
            },
        });
    }

    /**
     * Set up the app on the page
     */
    async setup(mainCanvas: HTMLCanvasElement) {
        await this.#setUser();
        await this.ui.settings.load();
        await this.#loadExtensions();

        // Mount the LiteGraph in the DOM
        mainCanvas.style.touchAction = 'none';
        const canvasEl = (this.canvasEl = Object.assign(mainCanvas, {
            id: 'graph-canvas',
        }));
        canvasEl.tabIndex = 1;
        document.body.prepend(canvasEl);

        addDomClippingSetting();

        this.graph = new ComfyGraph(this);

        this.canvas = new ComfyCanvas(this, canvasEl, this.graph);
        this.ctx = canvasEl.getContext('2d');

        LiteGraph.release_link_on_empty_shows_menu = true;
        LiteGraph.alt_drag_do_clone_nodes = true;

        this.graph.start();

        await this.invokeExtensionsAsync('init');
        await this.registerNodes();

        // Load previous workflow
        let restored = false;
        try {
            const json = localStorage.getItem('workflow');
            if (json) {
                const workflow = JSON.parse(json);
                await this.loadGraphData(workflow);
                restored = true;
            }
        } catch (err) {
            console.error('Error loading previous workflow', err);
        }

        // We failed to restore a workflow so load the default
        if (!restored) {
            await this.loadGraphData();
        }

        // Save current workflow automatically
        this.saveInterval = setInterval(
            () => localStorage.setItem('workflow', JSON.stringify(this.graph?.serialize())),
            1000
        );

        this.#addDropHandler();
        this.#addCopyHandler();
        this.#addPasteHandler();
        this.#addKeyboardHandler();

        await this.invokeExtensionsAsync('setup');
    }

    /** Registers nodes with the graph */
    async registerNodes() {
        // Load node definitions from the backend
        const defs = await this.api.getNodeDefs();
        await this.registerNodesFromDefs(defs);
        await this.invokeExtensionsAsync('registerCustomNodes');
    }

    getWidgetType(inputData: string | string[], inputName: string): string | null {
        const type = inputData[0];

        if (Array.isArray(type)) {
            return 'COMBO';
        } else if (this.widgets && `${type}:${inputName}` in this.widgets) {
            return `${type}:${inputName}`;
        } else if (this.widgets && type in this.widgets) {
            return type;
        } else {
            return null;
        }
    }

    // Register a node class so it can be listed when we want to create a new one
    async registerNodeDef(nodeId: string, nodeData: any) {
        const app = this;

        // Capture nodeData and app in a closure and return a new constructor function
        const comfyNodeConstructor = class extends ComfyNode {
            static title: string;
            static comfyClass: string;
            static nodeData: any;

            constructor() {
                super(nodeData, app);
            }
        };

        // Add these properties in as well to maintain consistency for the extension-message broadcast
        // we're about to do. Idk if any of the extensions actually use this info though.
        comfyNodeConstructor.title = nodeData.display_name || nodeData.name;
        comfyNodeConstructor.comfyClass = nodeData.name;
        comfyNodeConstructor.nodeData = nodeData;

        await this.invokeExtensionsAsync('beforeRegisterNodeDef', comfyNodeConstructor, nodeData);

        LiteGraph.registerNodeType(nodeId, comfyNodeConstructor);
    }

    async registerNodesFromDefs(defs: Record<string, ComfyObjectInfo>) {
        await this.invokeExtensionsAsync('addCustomNodeDefs', defs);

        // Generate list of known widgets
        this.widgets = Object.assign(
            {},
            ComfyWidgets,
            ...(await this.invokeExtensionsAsync('getCustomWidgets')).filter(Boolean)
        );

        // Register a node for each definition
        for (const nodeId in defs) {
            this.registerNodeDef(nodeId, defs[nodeId]);
        }
    }

    loadTemplateData(templateData?: TemplateData) {
        if (!templateData?.templates) {
            return;
        }

        const old = localStorage.getItem('litegrapheditor_clipboard');

        var maxY: number | boolean, nodeBottom: number | boolean, node;

        for (const template of templateData.templates) {
            if (!template?.data) {
                continue;
            }

            localStorage.setItem('litegrapheditor_clipboard', template.data);
            this.canvas?.pasteFromClipboard();

            // Move mouse position down to paste the next template below

            maxY = false;

            for (const i in this.canvas?.selected_nodes) {
                node = this.canvas?.selected_nodes[Number(i)];

                nodeBottom = node.pos[1] + node.size[1];

                if (maxY === false || nodeBottom > maxY) {
                    maxY = nodeBottom;
                }
            }

            if (this.canvas && typeof maxY === 'number') {
                this.canvas.graph_mouse[1] = maxY + 50;
            }
        }

        localStorage.setItem('litegrapheditor_clipboard', String(old));
    }

    // TODO: properly type the params
    showMissingNodesError(missingNodeTypes: any[], hasAddedNodes = true) {
        let seenTypes = new Set<string>();

        this.ui.dialog.show(
            $el('div.comfy-missing-nodes', [
                $el('span', {
                    textContent: 'When loading the graph, the following node types were not found: ',
                }),
                $el(
                    'ul',
                    Array.from(new Set(missingNodeTypes))
                        .map(t => {
                            let children = [];
                            if (typeof t === 'object') {
                                if (seenTypes.has(t.type)) return null;
                                seenTypes.add(t.type);
                                children.push($el('span', { textContent: t.type }));
                                if (t.hint) {
                                    children.push($el('span', { textContent: t.hint }));
                                }
                                if (t.action) {
                                    children.push(
                                        $el('button', {
                                            onclick: t.action.callback,
                                            textContent: t.action.text,
                                        })
                                    );
                                }
                            } else {
                                if (seenTypes.has(t)) return null;
                                seenTypes.add(t);
                                children.push($el('span', { textContent: t }));
                            }
                            return $el('li', children);
                        })
                        .filter(Boolean) as Element[]
                ),
                ...(hasAddedNodes
                    ? [
                          $el('span', {
                              textContent: 'Nodes that have failed to load will show as red on the graph.',
                          }),
                      ]
                    : []),
            ])
        );
        this.logging.addEntry('Comfy.App', 'warn', {
            MissingNodes: missingNodeTypes,
        });
    }

    /**
     * Populates the graph with the specified workflow data
     * @param {*} graphData A serialized graph object
     * @param { boolean } clean If the graph state, e.g. images, should be cleared
     */
    async loadGraphData(graphData?: any, clean: boolean = true) {
        if (clean) {
            this.clean();
        }

        let reset_invalid_values = false;
        if (!graphData) {
            graphData = defaultGraph;
            reset_invalid_values = true;
        }

        if (typeof structuredClone === 'undefined') {
            graphData = JSON.parse(JSON.stringify(graphData));
        } else {
            graphData = structuredClone(graphData);
        }

        const missingNodeTypes: string[] = [];
        await this.invokeExtensionsAsync('beforeConfigureGraph', graphData, missingNodeTypes);
        for (let n of graphData.nodes) {
            // Patch T2IAdapterLoader to ControlNetLoader since they are the same node now
            if (n.type == 'T2IAdapterLoader') n.type = 'ControlNetLoader';
            if (n.type == 'ConditioningAverage ') n.type = 'ConditioningAverage'; //typo fix
            if (n.type == 'SDV_img2vid_Conditioning') n.type = 'SVD_img2vid_Conditioning'; //typo fix

            // Find missing node types
            if (!(n.type in LiteGraph.registered_node_types)) {
                missingNodeTypes.push(n.type);
                n.type = sanitizeNodeName(n.type);
            }
        }

        try {
            this.graph?.configure(graphData);
        } catch (error) {
            const err = error as ComfyError;
            let errorHint = [];
            // Try extracting filename to see if it was caused by an extension script
            const filename = err.fileName || (err.stack || '').match(/(\/extensions\/.*\.js)/)?.[1];
            const pos = (filename || '').indexOf('/extensions/');
            if (pos > -1) {
                errorHint.push(
                    $el('span', {
                        textContent: 'This may be due to the following script:',
                    }),
                    $el('br', {}),
                    $el('span', {
                        style: {
                            fontWeight: 'bold',
                        },
                        textContent: filename?.substring(pos),
                    })
                );
            }

            // Show dialog to let the user know something went wrong loading the data
            this.ui.dialog.show(
                $el('div', [
                    $el('p', {
                        textContent: 'Loading aborted due to error reloading workflow data',
                    }),
                    $el('pre', {
                        style: { padding: '5px', backgroundColor: 'rgba(255,0,0,0.2)' },
                        textContent: err.toString(),
                    }),
                    $el('pre', {
                        style: {
                            padding: '5px',
                            color: '#ccc',
                            fontSize: '10px',
                            maxHeight: '50vh',
                            overflow: 'auto',
                            backgroundColor: 'rgba(0,0,0,0.2)',
                        },
                        textContent: err.stack || 'No stacktrace available',
                    }),
                    ...errorHint,
                ]).outerHTML
            );

            return;
        }

        // for (const node of this.graph._nodes) {
        for (const node of this.graph?.nodes || []) {
            const size = node.computeSize();
            size[0] = Math.max(node.size[0], size[0]);
            size[1] = Math.max(node.size[1], size[1]);
            node.size = size;

            if (node.widgets) {
                // If you break something in the backend and want to patch workflows in the frontend
                // This is the place to do this
                for (let widget of node.widgets) {
                    if (node.type == 'KSampler' || node.type == 'KSamplerAdvanced') {
                        if (widget.name == 'sampler_name') {
                            if (widget.value.startsWith('sample_')) {
                                widget.value = widget.value.slice(7);
                            }
                        }
                    }
                    if (node.type == 'KSampler' || node.type == 'KSamplerAdvanced' || node.type == 'PrimitiveNode') {
                        if (widget.name == 'control_after_generate') {
                            if (widget.value === true) {
                                widget.value = 'randomize';
                            } else if (widget.value === false) {
                                widget.value = 'fixed';
                            }
                        }
                    }
                    if (reset_invalid_values) {
                        if (widget.type == 'combo') {
                            if (!widget.options.values.includes(widget.value) && widget.options.values.length > 0) {
                                widget.value = widget.options.values[0];
                            }
                        }
                    }
                }
            }

            this.#invokeExtensions('loadedGraphNode', node);
        }

        if (missingNodeTypes.length) {
            this.showMissingNodesError(missingNodeTypes);
        }
        await this.invokeExtensionsAsync('afterConfigureGraph', missingNodeTypes);
    }

    /**
     * Converts the current graph workflow for sending to the API
     * @returns The workflow and node links
     */
    async graphToPrompt() {
        // for (const outerNode of this.graph.computeExecutionOrder(false)) {
        for (const outerNode of this.graph?.computeExecutionOrder(false, false)) {
            if (outerNode.widgets) {
                for (const widget of outerNode.widgets) {
                    // Allow widgets to run callbacks before a prompt has been queued
                    // e.g. random seed before every gen
                    widget.beforeQueued?.();
                }
            }

            const innerNodes = outerNode.getInnerNodes ? outerNode.getInnerNodes() : [outerNode];
            for (const node of innerNodes) {
                if (node.isVirtualNode) {
                    // Don't serialize frontend only nodes but let them make changes
                    if (node.applyToGraph) {
                        node.applyToGraph();
                    }
                }
            }
        }

        const workflow = this.graph?.serialize();
        const output: Record<string, WorkflowStep> = {};
        // Process nodes in order of execution
        // for (const outerNode of this.graph.computeExecutionOrder(false)) {
        for (const outerNode of this.graph?.computeExecutionOrder(false, false)) {
            const skipNode = outerNode.mode === 2 || outerNode.mode === 4;
            const innerNodes = !skipNode && outerNode.getInnerNodes ? outerNode.getInnerNodes() : [outerNode];
            for (const node of innerNodes) {
                if (node.isVirtualNode) {
                    continue;
                }

                if (node.mode === 2 || node.mode === 4) {
                    // Don't serialize muted nodes
                    continue;
                }

                const inputs: Record<string, any> = {};
                const widgets = node.widgets;

                // Store all widget values
                if (widgets) {
                    for (const i in widgets) {
                        const widget = widgets[i];
                        if (!widget.options || widget.options.serialize !== false) {
                            inputs[widget.name] = widget.serializeValue
                                ? await widget.serializeValue(node, i)
                                : widget.value;
                        }
                    }
                }

                // Store all node links
                for (let i in node.inputs) {
                    let parent = node.getInputNode(i);
                    if (parent) {
                        let link = node.getInputLink(i);
                        while (parent.mode === 4 || parent.isVirtualNode) {
                            let found = false;
                            if (parent.isVirtualNode) {
                                link = parent.getInputLink(link.origin_slot);
                                if (link) {
                                    parent = parent.getInputNode(link.target_slot);
                                    if (parent) {
                                        found = true;
                                    }
                                }
                            } else if (link && parent.mode === 4) {
                                let all_inputs = [link.origin_slot];
                                if (parent.inputs) {
                                    all_inputs = all_inputs.concat(Object.keys(parent.inputs));
                                    for (let parent_input in all_inputs) {
                                        parent_input = all_inputs[parent_input];
                                        if (parent.inputs[parent_input]?.type === node.inputs[i].type) {
                                            link = parent.getInputLink(parent_input);
                                            if (link) {
                                                parent = parent.getInputNode(parent_input);
                                            }
                                            found = true;
                                            break;
                                        }
                                    }
                                }
                            }

                            if (!found) {
                                break;
                            }
                        }

                        if (link) {
                            if (parent?.updateLink) {
                                link = parent.updateLink(link);
                            }
                            if (link) {
                                inputs[node.inputs[i].name] = [String(link.origin_id), parseInt(link.origin_slot)];
                            }
                        }
                    }
                }

                let node_data: WorkflowStep = {
                    class_type: node.comfyClass,
                    inputs,
                };

                if (this.ui.settings.getSettingValue('Comfy.DevMode')) {
                    // Ignored by the backend.
                    node_data['_meta'] = {
                        title: node.title,
                    };
                }

                output[String(node.id)] = node_data;
            }
        }

        // Remove inputs connected to removed nodes
        // TO DO: we need to console log this to figure out wtf is happening
        for (const o in output) {
            for (const i in output[o].inputs) {
                if (
                    // @ts-expect-error
                    Array.isArray(output[o].inputs[i]) &&
                    // @ts-expect-error
                    output[o].inputs[i].length === 2 &&
                    // @ts-expect-error
                    !output[output[o].inputs[i][0]]
                ) {
                    // @ts-expect-error
                    delete output[o].inputs[i];
                }
            }
        }

        return { workflow, output };
    }

    #formatPromptError(error: ComfyPromptError | string | null) {
        if (error == null) {
            return '(unknown error)';
        } else if (typeof error === 'string') {
            return error;
        } else if (error.stack && error.message) {
            return error.toString();
        } else if (error.response) {
            let message = error.response.error.message;
            if (error.response.error.details) message += ': ' + error.response.error.details;
            for (const [_, nodeError] of Object.entries(error.response.node_errors)) {
                message += '\n' + nodeError.class_type + ':';
                for (const errorReason of nodeError.errors) {
                    message += '\n    - ' + errorReason.message + ': ' + errorReason.details;
                }
            }
            return message;
        }
        return '(unknown error)';
    }

    #formatExecutionError(error: ComfyError | null) {
        if (error == null) {
            return '(unknown error)';
        }

        const traceback = error.traceback.join('');
        const nodeType = error.node_type;

        return `Error occurred when executing ${nodeType}:\n\n${error.exception_message}\n\n${traceback}`;
    }

    async queuePrompt(number: number, batchCount = 1) {
        this.#queueItems.push({ number, batchCount });

        // Only have one action process the items so each one gets a unique seed correctly
        if (this.#processingQueue) {
            return;
        }

        this.#processingQueue = true;
        this.lastNodeErrors = null;

        try {
            while (this.#queueItems.length) {
                const queueItem = this.#queueItems.pop();
                if (queueItem) {
                    ({ number, batchCount } = queueItem);

                    for (let i = 0; i < batchCount; i++) {
                        const p = await this.graphToPrompt();

                        try {
                            const res = await this.api.queuePrompt(number, p);
                            this.lastNodeErrors = res.node_errors;

                            if (this.lastNodeErrors) {
                                let errors = Array.isArray(this.lastNodeErrors)
                                    ? this.lastNodeErrors
                                    : Object.keys(this.lastNodeErrors);
                                if (errors.length > 0) {
                                    this.canvas?.draw(true, true);
                                }
                            }
                        } catch (error: unknown) {
                            const err = error as ComfyPromptError;

                            const formattedError = this.#formatPromptError(err);
                            this.ui.dialog.show(formattedError);
                            if (err.response) {
                                this.lastNodeErrors = err.response.node_errors;
                                this.canvas?.draw(true, true);
                            }
                            break;
                        }

                        if (p.workflow) {
                            for (const n of p.workflow.nodes) {
                                const node = this.graph?.getNodeById(n.id);
                                if (node?.widgets) {
                                    for (const widget of node.widgets) {
                                        // Allow widgets to run callbacks after a prompt has been queued
                                        // e.g. random seed after every gen
                                        if (widget.afterQueued) {
                                            widget.afterQueued();
                                        }
                                    }
                                }
                            }
                        }

                        this.canvas?.draw(true, true);
                        await this.ui.queue.update();
                    }
                }
            }
        } finally {
            this.#processingQueue = false;
        }
        this.api.dispatchEvent(new CustomEvent("promptQueued", { detail: { number, batchCount } }));
    }

    /**
     * Loads workflow data from the specified file
     * @param {File} file
     */
    async handleFile(file: File) {
        if (file.type === 'image/png') {
            const pngInfo = await getPngMetadata(file);
            if (pngInfo) {
                if (pngInfo.workflow) {
                    await this.loadGraphData(JSON.parse(pngInfo.workflow));
                } else if (pngInfo.prompt) {
                    this.loadApiJson(JSON.parse(pngInfo.prompt));
                } else if (pngInfo.parameters) {
                    importA1111(this.graph!, pngInfo.parameters);
                }
            }
        } else if (file.type === 'image/webp') {
            const pngInfo = await getWebpMetadata(file);
            if (pngInfo) {
                if (pngInfo.workflow) {
                    this.loadGraphData(JSON.parse(pngInfo.workflow));
                } else if (pngInfo.Workflow) {
                    this.loadGraphData(JSON.parse(pngInfo.Workflow)); // Support loading workflows from that webp custom node.
                } else if (pngInfo.prompt) {
                    this.loadApiJson(JSON.parse(pngInfo.prompt));
                }
            }
        } else if (file.type === 'application/json' || file.name?.endsWith('.json')) {
            const reader = new FileReader();
            reader.onload = async () => {
                const jsonContent = JSON.parse(<string>reader.result);
                if (jsonContent?.templates) {
                    this.loadTemplateData(jsonContent);
                } else if (this.isApiJson(jsonContent)) {
                    this.loadApiJson(jsonContent);
                } else {
                    await this.loadGraphData(jsonContent);
                }
            };
            reader.readAsText(file);
        } else if (file.name?.endsWith('.latent') || file.name?.endsWith('.safetensors')) {
            const info = await getLatentMetadata(file);
            if (info.workflow) {
                await this.loadGraphData(JSON.parse(info.workflow));
            } else if (info.prompt) {
                this.loadApiJson(JSON.parse(info.prompt));
            }
        }
    }

    isApiJson(data: Record<string, any>) {
        return Object.values(data).every(v => v.class_type);
    }

    loadApiJson(apiData: Record<string, any>) {
        const missingNodeTypes = Object.values(apiData).filter(n => !LiteGraph.registered_node_types[n.class_type]);
        if (missingNodeTypes.length) {
            this.showMissingNodesError(
                missingNodeTypes.map(t => t.class_type),
                false
            );
            return;
        }

        const ids = Object.keys(apiData);
        this.graph?.clear();
        for (const id of ids) {
            const data = apiData[id];
            const node = LiteGraph.createNode<ComfyNode>(data.class_type);

            // ComfyUI is deliberating assigning node.id as a string, when Litegraph expects a number
            // @ts-expect-error
            node.id = isNaN(+id) ? id : +id;
            this.graph?.add(node);
        }

        for (const id of ids) {
            const data = apiData[id];
            const node = this.graph?.getNodeById(Number(id));

            for (const input in data.inputs ?? {}) {
                const value = data.inputs[input];
                if (value instanceof Array) {
                    const [fromId, fromSlot] = value;
                    const fromNode = this.graph?.getNodeById(fromId);
                    if (node) {
                        const toSlot = node?.inputs?.findIndex(inp => inp.name === input);
                        if (toSlot !== -1) {
                            fromNode?.connect(fromSlot, node, toSlot);
                        }
                    }
                } else {
                    const widget = node?.widgets?.find(w => w.name === input);
                    if (widget) {
                        widget.value = value;
                        widget.callback?.(value);
                    }
                }
            }
        }

        this.graph?.arrange();
    }

    /**
     * Registers a Comfy web extension with the app
     * @param {ComfyExtension} extension
     */
    registerExtension(extension: ComfyExtension) {
        if (!extension.name) {
            throw new Error("Extensions must have a 'name' property.");
        }
        if (this.extensions.find(ext => ext.name === extension.name)) {
            throw new Error(`Extension named '${extension.name}' already registered.`);
        }
        this.extensions.push(extension);
    }

    /**
     * Refresh combo list on whole nodes
     */
    async refreshComboInNodes() {
        const defs = await this.api.getNodeDefs();

        for (const nodeId in defs) {
            this.registerNodeDef(nodeId, defs[nodeId]);
        }

        // for (let nodeNum in this.graph._nodes) {
        for (let nodeNum in this.graph?.nodes) {
            const node = this.graph.nodes[Number(nodeNum)] as ComfyNode;
            const def = defs[node.type!];

            // Allow primitive nodes to handle refresh
            node.refreshComboInNode?.(defs);

            if (!def) continue;

            for (const widgetNum in node.widgets) {
                const widget = node.widgets[widgetNum];
                if (widget.type == 'combo' && def.input && def.input.required?.[widget.name] !== undefined) {
                    widget.options.values = def['input']['required'][widget.name][0];

                    if (widget.name != 'image' && !widget.options.values.includes(widget.value)) {
                        widget.value = widget.options.values[0];
                        widget.callback(widget.value);
                    }
                }
            }
        }
    }

    /**
     * Clean current state
     */
    clean() {
        this.nodeOutputs = {};
        this.nodePreviewImages = {};
        this.lastNodeErrors = null;
        this.lastExecutionError = null;
        this.runningNodeId = null;
    }

    /** This should be called when unmounting ComfyUI App */
    cleanup() {
        if (this.graph) {
            this.graph.stop();
        }

        // Clear the save interval
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }

        // Remove event listeners added in setup
        this.abortController.abort();
        if (this.canvas) this.canvas.cleanup();

        // Remove the canvas element from the DOM if it was added
        if (this.canvasEl && this.canvasEl.parentNode) {
            this.canvasEl.parentNode.removeChild(this.canvasEl);
        }

        // Reset properties to their initial state
        this.canvasEl = null;
        this.ctx = null;
        this.graph = null;

        // Release any created object URLs
        for (const id in this.nodePreviewImages) {
            const urls = this.nodePreviewImages[id];
            if (Array.isArray(urls)) {
                urls.forEach(URL.revokeObjectURL);
            }
        }
        this.nodePreviewImages = {};

        // Invoke any necessary cleanup methods for extensions
        this.invokeExtensionsAsync('cleanup');

        // If there are any other properties or resources that were set up
        // and need to be cleaned up, do so here.

        // Reset UI elements or settings to their initial state
        if (this.ui) {
            // TODO: looks like the reset method does not exist
            // this.ui.reset(); // ??? this does not exist
        }
    }
}

// Every custom-node is built with the assumption that ComfyApp is a singleton
// class that is already instantiated and can be imported here.
export const app = new ComfyApp();