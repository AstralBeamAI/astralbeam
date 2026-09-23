Rails.application.routes.draw do
  resources :todos, only: %i[ index create update destroy ]
  resources :tenant_users, only: :index
  # The widget fetches its chat token here. See AstralBeamTokensController.
  post "astralbeam/token" => "astral_beam_tokens#create", as: :astral_beam_token

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  root "todos#index"
end
