ALTER TABLE "chat_message" DROP CONSTRAINT "chat_message_role_check", ADD CONSTRAINT "chat_message_role_check" CHECK ((
    ("role" = 'user' and "state" = 'complete' and "author_tenant_user_id" is not null and (("turn_message_id" is null and "turn_state" is not null) or ("turn_message_id" is not null and "turn_state" is null)))
    or ("role" in ('assistant', 'tool') and "turn_message_id" is not null and "turn_state" is null)
  ) and ("role" = 'assistant' or "state" = 'complete') and ("role" <> 'assistant' or "author_tenant_user_id" is null));