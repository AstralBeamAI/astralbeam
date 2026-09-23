import { Controller } from "@hotwired/stimulus"

// Submits the form as soon as one of its checkboxes changes.
export default class extends Controller {
  submit() {
    this.element.requestSubmit()
  }
}
