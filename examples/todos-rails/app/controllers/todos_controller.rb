# The page and the agent's tools both change todos through these JSON actions.
class TodosController < ApplicationController
  before_action :set_todo, only: %i[ update destroy ]

  def index
    @todos = Todo.order(:id)

    respond_to do |format|
      format.html
      format.json { render json: @todos }
    end
  end

  def create
    @todo = Todo.new(todo_params)

    if @todo.save
      render json: @todo, status: :created
    else
      render json: { errors: @todo.errors.full_messages }, status: :unprocessable_content
    end
  end

  def update
    if @todo.update(todo_params)
      render json: @todo
    else
      render json: { errors: @todo.errors.full_messages }, status: :unprocessable_content
    end
  end

  def destroy
    @todo.destroy!
    head :no_content
  end

  private
    def set_todo
      @todo = Todo.find(params.expect(:id))
    end

    def todo_params
      params.expect(todo: [ :text, :completed ])
    end
end
