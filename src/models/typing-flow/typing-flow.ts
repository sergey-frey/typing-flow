import { Renderer } from "@/models/renderer";
import { execute } from "@/shared/lib/generator";
import { isTextNode } from "@/shared/lib/node";
import type {
	RendererConfig,
	TypingFlowConfig,
	TypingFlowHooks,
	TypingFlowHooksAliases,
	TypingNode,
} from "@/types";
import { TypingFlowBase } from "./typing-flow-base";
import { callFunctionsArray } from "@/shared/lib/helpers";
import { hooksAliasesMap } from "@/shared/lib/hooks";
import { Queue } from "../queue";
import { Cursor } from "../cursor";

export class TypingFlow<
	Elem extends HTMLElement = HTMLElement,
> extends TypingFlowBase<Elem> {
	private _selector: string;
	private _container: Elem;

	private _nodeHandlers: Record<
		TypingNode["type"],
		(node: TypingNode, index: number) => void
	> = {
		clear: () => {},
		move: () => {},
		delete: () => {},
		text: () => {},
		tag: () => {},
		delay: () => {},
	};

	private _hooks: TypingFlowHooks = {
		onStart: [],
		onFinish: [],
	};

	private _renderer: Renderer;

	constructor(
		selector: string,
		config: Partial<TypingFlowConfig<Elem> & RendererConfig> = {},
	) {
		const {
			mode,
			charClass,
			charWithCursorClass,

			...baseConfig
		} = config;

		super(baseConfig);

		this._selector = selector;

		this._renderer = new Renderer({
			mode,
			charClass,
			charWithCursorClass,
		});

		this.config(baseConfig);
	}

	private _movePtrLeft() {
		this._cursor.prevWhile((node) => {
			return !isTextNode(node);
		});
	}

	private _movePtrRight() {
		this._cursor.nextWhile((node) => {
			return node && !isTextNode(node);
		});
	}

	private _handleTypingNode(node: TypingNode, index: number): Promise<void> {
		return new Promise((resolve) => {
			setTimeout(() => {
				this._nodeHandlers[node.type](node, index);

				this._renderer.render({
					container: this._container,
					queue: this._typingQueue,
					cursor: this._cursor,
				});

				resolve();
			}, node.delay);
		});
	}

	private _registerClearHandler() {
		this._nodeHandlers.clear = (node) => {
			if (node.type !== "clear") return;

			this._container[this._config.attr] = "" as Elem[keyof Elem];
			this._typingQueue = new Queue();
			this._cursor = new Cursor(this._typingQueue);
		};
	}

	private _registerMoveHandler() {
		this._nodeHandlers.move = (node, index) => {
			if (node.type !== "move") return;

			// Replace node with "START" or "END" direction to chain of "left" and "right" move nodes
			if (node.direction === "START" || node.direction === "END") {
				// result chain direction
				const direction = node.direction === "START" ? "left" : "right";

				// calculate amount of nodes to move
				const amountOfNodes =
					direction === "left"
						? index + 1
						: this._typingQueue.length - this._cursor.position + 1;

				this._nodesQueue.delete(index);

				for (let i = 0; i < amountOfNodes; i++) {
					this._nodesQueue.insert(index + i, { ...node, direction });
				}

				return;
			}

			if (node.direction === "left") {
				this._movePtrLeft();
			}

			if (node.direction === "right") {
				this._movePtrRight();
			}
		};
	}

	private _registerDeleteHandler() {
		this._nodeHandlers.delete = (node, index) => {
			if (node.type !== "delete") return;

			if (node.direction === "END" || node.direction === "START") {
				const direction = node.direction === "END" ? "right" : "left";

				const amountOfNodes =
					direction === "left"
						? index + 1
						: this._typingQueue.length - this._cursor.position + 1;

				this._nodesQueue.delete(index);

				for (let i = 0; i < amountOfNodes; i++) {
					this._nodesQueue.insert(index + i, { ...node, direction });
				}

				return;
			}

			if (node.direction === "left") {
				if (this._cursor.position === 0) return;

				this._cursor.prevWhile((node) => {
					return !["text", "tag"].includes(node.type);
				});
				this._typingQueue.delete(this._cursor.position);
			}

			if (node.direction === "right") {
				if (this._cursor.position < this._typingQueue.length) {
					this._typingQueue.delete(this._cursor.position);
				}
			}
		};
	}

	private _registerTextHandler() {
		const handler = (node: TypingNode) => {
			if (node.type !== "text" && node.type !== "tag") return;

			this._typingQueue.insert(this._cursor.position, node);
			this._cursor.next();
		};

		this._nodeHandlers.text = handler;
		this._nodeHandlers.tag = handler;
	}

	private *_typing() {
		for (let i = 0; i < this._nodesQueue.length; i++) {
			const node = this._nodesQueue[i];
			yield this._handleTypingNode(node, i);
		}
	}

	public on(alias: TypingFlowHooksAliases, fn: () => void) {
		const key = hooksAliasesMap[alias];
		this._hooks[key].push(fn);
		return this;
	}

	private async _executeFlow() {
		callFunctionsArray(...this._hooks.onStart);
		await execute(this._typing());
		callFunctionsArray(...this._hooks.onFinish);
	}

	// This is arrow function because we need to access to "this" of TypingFlow
	public start = async () => {
		const container = document.querySelector(this._selector) as Elem | null;

		if (container === null) {
			throw new Error(
				`TypingFlowError: Container with selector '${this._selector}' not found`,
			);
		}

		this._container = container;

		this._registerClearHandler();
		this._registerMoveHandler();
		this._registerDeleteHandler();
		this._registerTextHandler();

		if (this._config.loop) {
			this._hooks.onFinish.push(() => this._executeFlow());
		}

		this._executeFlow();

		return this;
	};
}
