require "test_helper"

# The agent's tools call these JSON actions, so the model sees their errors verbatim.
class TodosControllerTest < ActionDispatch::IntegrationTest
  test "creates, updates, and deletes todos as JSON" do
    post todos_path, params: { todo: { text: "  Water the plants " } }, as: :json
    assert_response :created
    todo = Todo.find(response.parsed_body["id"])
    assert_equal "Water the plants", todo.text

    patch todo_path(todo), params: { todo: { completed: true } }, as: :json
    assert_response :success
    assert_equal [ "Water the plants", true ], todo.reload.values_at(:text, :completed)

    delete todo_path(todo), as: :json
    assert_response :no_content
    assert_not Todo.exists?(todo.id)
  end

  test "rejects a todo without text" do
    post todos_path, params: { todo: { text: " " } }, as: :json
    assert_response :unprocessable_content
    assert_equal [ "Text can't be blank" ], response.parsed_body["errors"]
  end
end
