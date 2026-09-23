class CreateTodos < ActiveRecord::Migration[8.1]
  def change
    create_table :todos do |t|
      t.string :text, null: false
      t.boolean :completed, null: false, default: false

      t.timestamps
    end
  end
end
