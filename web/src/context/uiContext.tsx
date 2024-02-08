import React, { ReactNode, RefObject, useEffect, useRef, useState } from 'react';
import { createUseContextHook } from './hookCreator';
import { useSettings } from './settingsContext.tsx';
import { api } from '../scripts/api.tsx';
import { ComfyPromptStatus } from '../types/comfy.ts';
import { useComfyApp } from './appContext.tsx';
import { usePrompt } from '../hooks/usePrompt.tsx';
import { useGraph } from './graphContext.tsx';
import { useLoadGraphData } from '../hooks/useLoadGraphData.tsx';

type AutoQueueMode =
    | {
          text: string;
          value?: string;
          tooltip?: string;
      }
    | string
    | null;

interface ComfyUIContextType {}

const ComfyUIContext = React.createContext<ComfyUIContextType | null>(null);

export const ComfyUIContextProvider = ({ children }: { children: ReactNode }) => {
    const { addSetting, show: showSettings } = useSettings();
    const { queuePrompt, graphToPrompt } = usePrompt();
    const { lastExecutionError, clean: cleanApp } = useComfyApp();
    const { graph } = useGraph();
    const { loadGraphData } = useLoadGraphData();

    const [batchCount, setBatchCount] = useState(1);
    const [lastQueueSize, setLastQueueSize] = useState(0);
    const [queue, setQueue] = useState<ReactNode>([]);
    const [history, setHistory] = useState<ReactNode>([]);
    const [autoQueueMode, setAutoQueueMode] = useState<AutoQueueMode>(null);
    const [graphHasChanged, setGraphHasChanged] = useState(false);
    const [autoQueueEnabled, setAutoQueueEnabled] = useState(false);
    const [confirmClear, setConfirmClear] = useState<{ value: boolean }>({ value: false });
    const [promptFilename, setPromptFilename] = useState<{ value: boolean }>({ value: false });

    const menuContainerEl = useRef<HTMLDivElement>(null);
    const queueSizeEl = useRef<HTMLDivElement>(null);
    const autoQueueModeElRef = useRef<HTMLDivElement>(null);

    const setStatus = (status: ComfyPromptStatus) => {
        if (!queueSizeEl.current) return;
        queueSizeEl.current.textContent = 'Queue size: ' + (status ? status.exec_info.queue_remaining : 'ERR');

        if (status) {
            if (
                lastQueueSize != 0 &&
                status.exec_info.queue_remaining == 0 &&
                autoQueueEnabled &&
                (autoQueueMode === 'instant' || graphHasChanged) &&
                !lastExecutionError
            ) {
                queuePrompt(0);
                status.exec_info.queue_remaining += batchCount;
                setGraphHasChanged(false);
            }
            setLastQueueSize(status.exec_info.queue_remaining);
        }
    };

    useEffect(() => {
        api.addEventListener('status', () => {
            // this.queue.update();
            // this.history.update();
        });

        const confirmClear = addSetting({
            id: 'Comfy.ConfirmClear',
            name: 'Require confirmation when clearing workflow',
            type: 'boolean',
            defaultValue: true,
            onChange: () => undefined,
        });
        setConfirmClear(() => confirmClear);

        const promptFilename = addSetting({
            id: 'Comfy.PromptFilename',
            name: 'Prompt for filename when saving workflow',
            type: 'boolean',
            defaultValue: false,
            onChange: () => undefined,
        });
        setPromptFilename(() => promptFilename);

        /* file format for preview
         *
         * format;quality
         *
         * ex)
         * webp;50 -> webp, quality 50
         * jpeg;80 -> rgb, jpeg, quality 80
         *
         * @type {string}
         */

        addSetting({
            id: 'Comfy.PreviewFormat',
            name: 'When displaying a preview in the image widget, convert it to a lightweight image, e.g. webp, jpeg, webp;50, etc.',
            type: 'text',
            defaultValue: '',
            onChange: () => undefined,
        });

        addSetting({
            id: 'Comfy.DisableSliders',
            name: 'Disable sliders.',
            type: 'boolean',
            defaultValue: false,
            onChange: () => undefined,
        });

        addSetting({
            id: 'Comfy.DisableFloatRounding',
            name: 'Disable rounding floats (requires page reload).',
            type: 'boolean',
            defaultValue: false,
            onChange: () => undefined,
        });

        addSetting({
            id: 'Comfy.FloatRoundingPrecision',
            name: 'Decimal places [0 = auto] (requires page reload).',
            type: 'slider',
            attrs: {
                min: 0,
                max: 6,
                step: 1,
            },
            defaultValue: 0,
            onChange: () => undefined,
        });

        api.addEventListener('graphChanged', () => {
            if (autoQueueMode === 'change' && autoQueueEnabled) {
                if (lastQueueSize === 0) {
                    setGraphHasChanged(false);
                    queuePrompt(0);
                } else {
                    setGraphHasChanged(true);
                }
            }
        });

        addSetting({
            id: 'Comfy.DevMode',
            name: 'Enable Dev mode Options',
            type: 'boolean',
            defaultValue: false,
            onChange: function (value: string) {
                const devSaveApiButton = document.getElementById('comfy-dev-save-api-button');
                if (devSaveApiButton) {
                    devSaveApiButton.style.display = value ? 'block' : 'none';
                }
            },
        });
    }, []);

    const autoQueueModeEl = toggleSwitch(
        'autoQueueMode',
        [
            { text: 'instant', tooltip: 'A new prompt will be queued as soon as the queue reaches 0' },
            {
                text: 'change',
                tooltip: 'A new prompt will be queued when the queue is at 0 and the graph is/has changed',
            },
        ],
        {
            ref: autoQueueModeElRef,
            onChange: value => {
                setAutoQueueMode(value.item.value);
            },
        }
    );

    if (autoQueueModeElRef.current) {
        autoQueueModeElRef.current.style.display = 'none';
    }

    const fileInput = (
        <input
            id="comfy-file-input"
            type="file"
            accept=".json,image/png,.latent,.safetensors,image/webp"
            style={{ display: 'none' }}
            onChange={() => {
                if ('files' in fileInput && Array.isArray(fileInput.files)) {
                    // app.handleFile(fileInput.files[0]);
                }
            }}
        />
    );

    const menuContainer = (
        <div className="comfy-menu" ref={menuContainerEl}>
            <div
                className="drag-handle"
                style={{
                    overflow: 'hidden',
                    position: 'relative',
                    cursor: 'default',
                    width: '100%',
                }}
            >
                <span className="drag-handle" />
                <span ref={queueSizeEl} />
                <button className="comfy-settings-btn" onClick={showSettings}>
                    ⚙️
                </button>
            </div>

            <button id="queue-button" className="comfy-queue-btn" onClick={() => queuePrompt(0)}>
                Queue Prompt
            </button>

            <div>
                <label>
                    Extra Options
                    <input
                        type="checkbox"
                        onChange={i => {
                            let extraOptions = document.getElementById('extraOptions');
                            if (extraOptions) {
                                // extraOptions.style.display = i.srcElement.checked ? 'block' : 'none';
                                extraOptions.style.display = i.target.checked ? 'block' : 'none';

                                let batchCountInputRange = document.getElementById(
                                    'batchCountInputRange'
                                ) as HTMLInputElement;
                                // this.batchCount = i.srcElement.checked ? Number(batchCountInputRange.value) : 1;
                                setBatchCount(i.target.checked ? Number(batchCountInputRange.value) : 1);

                                let autoQueueCheckbox = document.getElementById(
                                    'autoQueueCheckbox'
                                ) as HTMLInputElement;
                                if (autoQueueCheckbox) {
                                    autoQueueCheckbox.checked = false;
                                }

                                setAutoQueueEnabled(false);
                            }
                        }}
                    />
                </label>
            </div>

            <div id="extraOptions" style={{ width: '100%', display: 'none' }}>
                <div>
                    <label>Batch Count</label>
                    <input
                        min={1}
                        type="number"
                        value={batchCount}
                        id="batchCountInputNumber"
                        style={{ width: '35%', marginLeft: '0.4em' }}
                        onInput={i => {
                            setBatchCount((i.target as any).value);
                            let batchCountInputRange = document.getElementById(
                                'batchCountInputRange'
                            ) as HTMLInputElement | null;

                            if (batchCountInputRange) {
                                batchCountInputRange.value = batchCount.toString();
                            }
                        }}
                    />

                    <input
                        type="range"
                        min={1}
                        max={100}
                        value={batchCount}
                        id="batchCountInputRange"
                        onInput={i => {
                            setBatchCount((i.target as any).value);
                            let batchCountInputNumber = document.getElementById(
                                'batchCountInputNumber'
                            ) as HTMLInputElement | null;
                            if (batchCountInputNumber) {
                                batchCountInputNumber.value = (i.target as any).value;
                            }
                        }}
                    />
                </div>

                <div>
                    <label htmlFor="autoQueueCheckbox">Auto Queue</label>
                    <input
                        id="autoQueueCheckbox"
                        type="checkbox"
                        checked={autoQueueEnabled}
                        title="Automatically queue prompt when the queue size hits 0"
                        onChange={e => {
                            setAutoQueueEnabled(e.target.checked);
                            if (autoQueueModeElRef.current) {
                                autoQueueModeElRef.current.style.display = autoQueueEnabled ? '' : 'none';
                            }
                        }}
                    />
                    {autoQueueModeEl}
                </div>
            </div>

            <div className="comfy-menu-btns">
                <button id="queue-front-button" onClick={() => queuePrompt(-1)}>
                    Queue Front
                </button>
                <button
                    id="comfy-view-queue-button"
                    // ref={this.queue.button = b as HTMLButtonElement}
                    onClick={() => {
                        // this.history.hide();
                        // this.queue.toggle();
                    }}
                >
                    View Queue
                </button>
                <button
                    id="comfy-view-history-button"
                    // ref={this.history.button = b as HTMLButtonElement}
                    onClick={() => {
                        // this.queue.hide();
                        // this.history.toggle();
                    }}
                >
                    View History
                </button>
            </div>

            {queue}
            {history}

            <button
                id="comfy-save-button"
                onClick={() => {
                    let filename: string | null = 'workflow.json';
                    if (promptFilename.value) {
                        filename = prompt('Save workflow as:', filename);
                        if (!filename) return;
                        if (!filename.toLowerCase().endsWith('.json')) {
                            filename += '.json';
                        }
                    }

                    graphToPrompt().then((p: any) => {
                        const json = JSON.stringify(p.workflow, null, 2); // convert the data to a JSON string
                        const blob = new Blob([json], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);

                        function Link() {
                            const ref = useRef<HTMLAnchorElement>(null);

                            useEffect(() => {
                                ref.current?.click();

                                return () => {
                                    setTimeout(function () {
                                        ref.current?.remove();
                                        window.URL.revokeObjectURL(url);
                                    }, 0);
                                };
                            }, []);

                            return <a ref={ref} href={url} download={filename} style={{ display: 'none' }} />;
                        }

                        return <Link />;
                    });
                }}
            >
                Save
            </button>

            <button
                id="comfy-dev-save-api-button"
                style={{ width: '100%', display: 'none' }}
                onClick={() => {
                    let filename: string | null = 'workflow_api.json';
                    if (promptFilename.value) {
                        filename = prompt('Save workflow (API) as:', filename);
                        if (!filename) return;
                        if (!filename.toLowerCase().endsWith('.json')) {
                            filename += '.json';
                        }
                    }

                    graphToPrompt().then((p: any) => {
                        const json = JSON.stringify(p.workflow, null, 2); // convert the data to a JSON string
                        const blob = new Blob([json], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);

                        function Link() {
                            const ref = useRef<HTMLAnchorElement>(null);

                            useEffect(() => {
                                ref.current?.click();

                                return () => {
                                    setTimeout(function () {
                                        ref.current?.remove();
                                        window.URL.revokeObjectURL(url);
                                    }, 0);
                                };
                            }, []);

                            return <a ref={ref} href={url} download={filename} style={{ display: 'none' }} />;
                        }

                        return <Link />;
                    });
                }}
            >
                Save (API Format)
            </button>

            <button
                id="comfy-load-button"
                onClick={() => {
                    // TODO: handle this
                    // fileInput.click();
                }}
            >
                Load
            </button>

            <button
                id="comfy-refresh-button"
                onClick={() => {
                    /*app.refreshComboInNodes()*/
                }}
            >
                Refresh
            </button>
            <button id="comfy-clipspace-button" onClick={() => {}}>
                Clipspace
            </button>
            <button
                id="comfy-clear-button"
                onClick={() => {
                    if (!confirmClear.value || confirm('Clear workflow?')) {
                        cleanApp();
                        graph.clear();
                    }
                }}
            >
                Clear
            </button>
            <button
                id="comfy-load-default-button"
                onClick={async () => {
                    if (!confirmClear.value || confirm('Load default workflow?')) {
                        await loadGraphData();
                    }
                }}
            >
                Load Default
            </button>
        </div>
    );

    useEffect(() => {
        setStatus({ exec_info: { queue_remaining: 'X' } });
    }, [queueSizeEl]);

    useEffect(() => {
        if (menuContainerEl.current) {
            dragElement(menuContainerEl.current, addSetting);
        }
    }, [menuContainerEl]);

    return (
        <ComfyUIContext.Provider value={{}}>
            {menuContainer}
            {children}
        </ComfyUIContext.Provider>
    );
};

export const useComfyUI = createUseContextHook(ComfyUIContext, 'ComfyUIContext not found');

type RawInput = {
    text: string;
    value?: string;
    tooltip?: string;
    selected?: boolean;
};

interface RadioInputProps {
    index: number;
    item: RawInput;
    handleSelect: (index: number) => void;
}

export function toggleSwitch(
    name: string,
    items: (RawInput | string)[],
    { onChange, ref }: { ref?: RefObject<HTMLDivElement>; onChange?: (value: any) => void } = {}
) {
    let selectedIndex: number | null = null;

    // TODO: if none is selected, select the first one

    const RadioInput = ({ index, item, handleSelect }: RadioInputProps) => {
        const [selected, setSelected] = useState(false);

        useEffect(() => {
            if (item.selected) {
                setSelected(item.selected);
                handleSelect(index);
            }
        }, []);

        return (
            <label className={selected ? 'comfy-toggle-selected' : ''} title={item.tooltip ?? ''}>
                <input
                    name={name}
                    type="radio"
                    value={item.value ?? item.text}
                    checked={(item as RawInput).selected}
                    onChange={() => {
                        setSelected(selected => !selected);
                        handleSelect(index);
                    }}
                />
            </label>
        );
    };

    const handleSelected = (index: number) => {
        onChange?.({
            item: items[index],
            prev: selectedIndex == null ? undefined : items[selectedIndex],
        });

        selectedIndex = index;
    };

    const elements = items.map((item, i) => {
        if (typeof item === 'string') {
            item = { text: item };
        }

        if (!item.value) {
            item.value = item.text;
        }

        return <RadioInput key={i} handleSelect={handleSelected} item={item} index={i} />;
    });

    return (
        <div ref={ref} className="comfy-toggle-switch" style={{ display: 'none' }}>
            {elements}
        </div>
    );
}

function dragElement(dragEl: HTMLDivElement, addSetting: any) {
    var posDiffX = 0,
        posDiffY = 0,
        posStartX = 0,
        posStartY = 0,
        newPosX = 0,
        newPosY = 0;

    if (dragEl.getElementsByClassName('drag-handle')[0]) {
        // if present, the handle is where you move the DIV from:
        (dragEl.getElementsByClassName('drag-handle')[0] as HTMLElement).onmousedown = dragMouseDown;
    } else {
        // otherwise, move the DIV from anywhere inside the DIV:
        dragEl.onmousedown = dragMouseDown;
    }

    // When the element resizes (e.g. view queue) ensure it is still in the windows bounds
    const resizeObserver = new ResizeObserver(() => ensureInBounds());
    resizeObserver.observe(dragEl);

    function ensureInBounds() {
        if (dragEl.classList.contains('comfy-menu-manual-pos')) {
            newPosX = Math.min(document.body.clientWidth - dragEl.clientWidth, Math.max(0, dragEl.offsetLeft));
            newPosY = Math.min(document.body.clientHeight - dragEl.clientHeight, Math.max(0, dragEl.offsetTop));

            positionElement();
        }
    }

    function positionElement() {
        const halfWidth = document.body.clientWidth / 2;
        const anchorRight = newPosX + dragEl.clientWidth / 2 > halfWidth;

        // set the element's new position:
        if (anchorRight) {
            dragEl.style.left = 'unset';
            dragEl.style.right = document.body.clientWidth - newPosX - dragEl.clientWidth + 'px';
        } else {
            dragEl.style.left = newPosX + 'px';
            dragEl.style.right = 'unset';
        }

        dragEl.style.top = newPosY + 'px';
        dragEl.style.bottom = 'unset';

        if (savePos) {
            localStorage.setItem(
                'Comfy.MenuPosition',
                JSON.stringify({
                    x: dragEl.offsetLeft,
                    y: dragEl.offsetTop,
                })
            );
        }
    }

    function restorePos() {
        let pos = localStorage.getItem('Comfy.MenuPosition');
        if (pos) {
            const newPos = JSON.parse(pos);
            newPosX = newPos.x;
            newPosY = newPos.y;
            positionElement();
            ensureInBounds();
        }
    }

    let savePos: undefined | any = undefined;
    addSetting({
        id: 'Comfy.MenuPosition',
        name: 'Save menu position',
        type: 'boolean',
        defaultValue: savePos,
        onChange(value: any) {
            if (savePos === undefined && value) {
                restorePos();
            }
            savePos = value;
        },
    });

    function dragMouseDown(e: MouseEvent) {
        e = e || window.event;
        e.preventDefault();
        // get the mouse cursor position at startup:
        posStartX = e.clientX;
        posStartY = e.clientY;
        document.onmouseup = closeDragElement;
        // call a function whenever the cursor moves:
        document.onmousemove = elementDrag;
    }

    function elementDrag(e: MouseEvent) {
        e = e || window.event;
        e.preventDefault();

        dragEl.classList.add('comfy-menu-manual-pos');

        // calculate the new cursor position:
        posDiffX = e.clientX - posStartX;
        posDiffY = e.clientY - posStartY;
        posStartX = e.clientX;
        posStartY = e.clientY;

        newPosX = Math.min(document.body.clientWidth - dragEl.clientWidth, Math.max(0, dragEl.offsetLeft + posDiffX));
        newPosY = Math.min(document.body.clientHeight - dragEl.clientHeight, Math.max(0, dragEl.offsetTop + posDiffY));

        positionElement();
    }

    window.addEventListener('resize', () => {
        ensureInBounds();
    });

    function closeDragElement() {
        // stop moving when mouse button is released:
        document.onmouseup = null;
        document.onmousemove = null;
    }
}