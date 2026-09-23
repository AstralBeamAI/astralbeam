class TodosController < ApplicationController
  before_action :set_todo, only: %i[ update destroy ]

  def index
    @todos = Todo.order(:id)
    @assistant_hidden = params[:assistant] == "hidden"
    @debug = params[:debug] == "on"

    respond_to do |format|
      format.html
      format.json { render json: @todos }
    end
  end

  def create
    @todo = Todo.new(todo_params)

    respond_to do |format|
      if @todo.save
        format.html { redirect_back_or_to todos_path }
        format.json { render json: @todo, status: :created }
      else
        format.html { redirect_back_or_to todos_path, alert: @todo.errors.full_messages.to_sentence }
        format.json { render json: { errors: @todo.errors.full_messages }, status: :unprocessable_content }
      end
    end
  end

  def update
    respond_to do |format|
      if @todo.update(todo_params)
        format.html { redirect_back_or_to todos_path }
        format.json { render json: @todo }
      else
        format.html { redirect_back_or_to todos_path, alert: @todo.errors.full_messages.to_sentence }
        format.json { render json: { errors: @todo.errors.full_messages }, status: :unprocessable_content }
      end
    end
  end

  def destroy
    @todo.destroy!

    respond_to do |format|
      format.html { redirect_back_or_to todos_path }
      format.json { head :no_content }
    end
  end

  private
    def set_todo
      @todo = Todo.find(params.expect(:id))
    end

    def todo_params
      params.expect(todo: [ :text, :completed ])
    end
end
