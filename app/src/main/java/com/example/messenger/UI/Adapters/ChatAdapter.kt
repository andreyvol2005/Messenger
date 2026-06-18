package com.example.messenger.UI.Adapters

import android.content.Intent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.example.messenger.R
import com.example.messenger.UI.Chat
import com.example.messenger.data.local.entities.ChatEntity
import com.example.messenger.databinding.ItemChatBinding

class ChatAdapter(
    private val chats: List<ChatEntity>,
    private val onChatDelete: ((ChatEntity) -> Unit)? = null
) : RecyclerView.Adapter<ChatAdapter.ChatViewHolder>() {

    class ChatViewHolder(val binding: ItemChatBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ChatViewHolder {
        val binding = ItemChatBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ChatViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ChatViewHolder, position: Int) {
        val chat = chats[position]

        val title = when (chat.type) {
            "group" -> chat.name ?: "Группа"
            else -> chat.partnerNickname ?: chat.partnerUsername ?: "Unknown"
        }

        holder.binding.tvUsername.text = title
        holder.binding.tvnic.visibility = View.GONE
        holder.binding.tvLastMessage.text = chat.lastMessageText ?: "Нет сообщений"

        // Аватарка
        if (!chat.partnerAvatarUrl.isNullOrEmpty()) {
            Glide.with(holder.itemView.context)
                .load(chat.partnerAvatarUrl)
                .placeholder(R.drawable.ic_avatar_default)
                .into(holder.binding.ivAvatar)
        } else {
            holder.binding.ivAvatar.setImageResource(R.drawable.ic_avatar_default)
        }

        // Статус прочтения и счётчик непрочитанных
        // TODO: добавить логику после реализации сообщений
        holder.binding.ivReadStatus.setImageResource(R.drawable.check)
        holder.binding.flUnreadCount.visibility = View.GONE

        // Обычное нажатие — открыть чат
        holder.itemView.setOnClickListener {
            val intent = Intent(holder.itemView.context, Chat::class.java).apply {
                putExtra("chatId", chat.id)
                putExtra("chatTitle", title)
            }
            holder.itemView.context.startActivity(intent)
        }

        // Долгое нажатие — удалить чат
        holder.itemView.setOnLongClickListener {
            showDeleteDialog(chat, holder)
            true
        }
    }

    private fun showDeleteDialog(chat: ChatEntity, holder: ChatViewHolder) {
        AlertDialog.Builder(holder.itemView.context)
            .setTitle("Удалить чат")
            .setMessage("Вы уверены, что хотите удалить этот чат?")
            .setPositiveButton("Удалить") { _, _ ->
                onChatDelete?.invoke(chat)
                Toast.makeText(holder.itemView.context, "Чат удалён", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    override fun getItemCount(): Int = chats.size
}