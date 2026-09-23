import { Controller } from "@hotwired/stimulus"
import { Turbo } from "@hotwired/turbo-rails"
import { mountAstralBeamChat } from "@astralbeam/sdk/client"
import { appearance, csrfToken, tokenRequest } from "astralbeam_config"

// Mounts the chat sidebar and lets its agent manage todos through TodosController's JSON API.
export default class extends Controller {
  static targets = ["sidebar", "todoCard"]
  static values = {
    apiUrl: String,
    agentId: String,
    title: String,
    colorScheme: String,
    customTheme: Boolean,
    debug: Boolean,
    todos: Array
  }

  connect() {
    this.cards = new Set()
    this.chat = mountAstralBeamChat(this.sidebarTarget, {
      apiUrl: this.apiUrlValue,
      // Empty falls back to the organization's default agent.
      agentId: this.agentIdValue || undefined,
      title: this.titleValue,
      fetchAstralBeamToken: tokenRequest(),
      sandboxPanel: true,
      debug: this.debugValue,
      tools: this.tools(),
      widgets: { todoCard: this.todoCard() },
      ...this.appearance()
    })
  }

  disconnect() {
    this.chat.unmount()
  }

  // A Turbo page refresh morphs these values in place, so the chat and its transcript survive it.
  colorSchemeValueChanged() {
    this.chat?.update(this.appearance())
  }

  customThemeValueChanged() {
    this.chat?.update(this.appearance())
  }

  debugValueChanged() {
    this.chat?.update({ debug: this.debugValue })
  }

  todosValueChanged() {
    this.cards?.forEach((draw) => draw())
  }

  appearance() {
    return appearance({ colorScheme: this.colorSchemeValue, customTheme: this.customThemeValue })
  }

  tools() {
    return {
      get_todos: {
        metadata: { title: "List the todos" },
        description: "List every todo with its id, text, and completed flag.",
        execute: async () => ({ todos: await this.request("GET", "/todos") })
      },
      create_todo: {
        metadata: { title: "Create a todo" },
        description: "Create a new todo and append it to the list.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "What needs to be done" },
            completed: { type: "boolean", description: "Whether it starts out done. Defaults to false." }
          },
          required: ["text"]
        },
        execute: async ({ text, completed }) => ({
          created: await this.request("POST", "/todos", { text, completed })
        })
      },
      update_todo: {
        metadata: { title: "Update a todo" },
        description: "Update a todo's text, its completed flag, or both, by its id.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "number", description: "Id of the todo to update" },
            text: { type: "string", description: "Replacement text; omit to keep the current one" },
            completed: { type: "boolean", description: "New completed state; omit to keep the current one" }
          },
          required: ["id"]
        },
        execute: async ({ id, text, completed }) => ({
          updated: await this.request("PATCH", `/todos/${todoId(id)}`, { text, completed })
        })
      },
      delete_todo: {
        metadata: { title: "Delete a todo" },
        description: "Delete a todo from the list by its id.",
        parameters: {
          type: "object",
          properties: { id: { type: "number", description: "Id of the todo to delete" } },
          required: ["id"]
        },
        execute: async ({ id }) => {
          await this.request("DELETE", `/todos/${todoId(id)}`)
          return { deleted: { id: todoId(id) } }
        }
      }
    }
  }

  // Cards render into the sidebar's light DOM, so this page's stylesheet styles them.
  todoCard() {
    return {
      description: "A single todo from the host app, addressed by its id",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number", description: "Id of the todo to render" },
          highlight: { type: "boolean", description: "Make the todo stand out in the conversation" }
        },
        required: ["id"]
      },
      render: ({ id, highlight }, container) => {
        const draw = () => {
          const todo = this.todosValue.find((candidate) => candidate.id === Number(id))
          const card = this.todoCardTarget.content.firstElementChild.cloneNode(true)
          const checkbox = card.querySelector("input")
          const text = card.querySelector("span")
          card.classList.toggle("todo-card-highlight", Boolean(highlight))
          checkbox.checked = todo?.completed ?? false
          checkbox.disabled = !todo
          checkbox.addEventListener("change", () =>
            this.request("PATCH", `/todos/${todo.id}`, { completed: !todo.completed })
          )
          text.textContent = todo?.text ?? "Deleted todo"
          text.classList.toggle("todo-done", Boolean(todo?.completed))
          container.replaceChildren(card)
        }
        draw()
        this.cards.add(draw)
        return () => this.cards.delete(draw)
      }
    }
  }

  async request(method, path, todo) {
    const response = await fetch(path, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
      // The model sends null for a field it wants unchanged; stringify drops the undefined ones.
      body: todo && JSON.stringify({ todo: Object.fromEntries(Object.entries(todo).filter(([, value]) => value != null)) })
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.errors?.join(", ") || `${method} ${path} answered ${response.status}`)
    // Morphs the page, including this controller's todos value, from the server's current state.
    if (method !== "GET") Turbo.visit(location.href, { action: "replace" })
    return body
  }
}

function todoId(id) {
  if (!Number.isSafeInteger(Number(id))) throw new Error("A todo needs a valid id")
  return Number(id)
}
