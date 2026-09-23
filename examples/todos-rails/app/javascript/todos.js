import { mountAstralBeamChat } from "@astralbeam/sdk/client"
import { bindAppearanceButtons, csrfToken, tokenRequest } from "astralbeam_config"

// The page and the agent change todos through TodosController's JSON API, then redraw from the server.
const app = document.getElementById("app")
let todos = JSON.parse(app.dataset.todos)
const cards = new Set()

async function request(method, path, todo) {
  const response = await fetch(path, {
    method,
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
    // The model sends null for a field it wants unchanged; stringify drops the undefined ones.
    body: todo && JSON.stringify({ todo: Object.fromEntries(Object.entries(todo).filter(([, value]) => value != null)) })
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.errors?.join(", ") || `${method} ${path} answered ${response.status}`)
  return body
}

async function change(method, path, todo) {
  const result = await request(method, path, todo)
  todos = await request("GET", "/todos")
  render()
  return result
}

function todoId(id) {
  if (!Number.isSafeInteger(Number(id))) throw new Error("A todo needs a valid id")
  return Number(id)
}

// Fills a cloned <template> row or card with one todo, whose checkbox toggles it.
function fill(element, todo) {
  const checkbox = element.querySelector("input")
  const text = element.querySelector("span")
  checkbox.checked = todo?.completed ?? false
  checkbox.disabled = !todo
  checkbox.addEventListener("change", () => change("PATCH", `/todos/${todo.id}`, { completed: !todo.completed }))
  text.textContent = todo?.text ?? "Deleted todo"
  text.classList.toggle("todo-done", Boolean(todo?.completed))
  return element
}

function clone(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true)
}

function render() {
  document.getElementById("todos").replaceChildren(...todos.map((todo) => fill(clone("todo-item"), todo)))
  cards.forEach((draw) => draw())
}

document.getElementById("new-todo").addEventListener("submit", async (event) => {
  event.preventDefault()
  const form = event.currentTarget
  await change("POST", "/todos", { text: form.elements.text.value })
  form.reset()
})

const chat = mountAstralBeamChat(document.getElementById("astralbeam-chat"), {
  apiUrl: app.dataset.apiUrl,
  // Absent falls back to the organization's default agent.
  agentId: app.dataset.agentId,
  title: "Todos assistant",
  fetchAstralBeamToken: tokenRequest(),
  sandboxPanel: true,
  tools: {
    get_todos: {
      metadata: { title: "List the todos" },
      description: "List every todo with its id, text, and completed flag.",
      execute: async () => ({ todos: await request("GET", "/todos") })
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
      execute: async ({ text, completed }) => ({ created: await change("POST", "/todos", { text, completed }) })
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
        updated: await change("PATCH", `/todos/${todoId(id)}`, { text, completed })
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
        await change("DELETE", `/todos/${todoId(id)}`)
        return { deleted: { id: todoId(id) } }
      }
    }
  },
  widgets: {
    // Cards render into the mount point's light DOM, so this page's stylesheet styles them.
    todoCard: {
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
          const card = fill(clone("todo-card"), todos.find((todo) => todo.id === Number(id)))
          card.classList.toggle("todo-card-highlight", Boolean(highlight))
          container.replaceChildren(card)
        }
        draw()
        cards.add(draw)
        return () => cards.delete(draw)
      }
    }
  }
})

bindAppearanceButtons((options) => chat.update(options))

const assistantButton = document.getElementById("assistant")
assistantButton.addEventListener("click", () => {
  const sidebar = document.getElementById("chat-sidebar")
  sidebar.hidden = !sidebar.hidden
  assistantButton.textContent = sidebar.hidden ? "Show assistant" : "Hide assistant"
})

const debugButton = document.getElementById("debug")
let debug = false
debugButton.addEventListener("click", () => {
  debug = !debug
  chat.update({ debug })
  debugButton.textContent = `Debug: ${debug ? "on" : "off"}`
})

render()
