package com.example.messenger.UI.Adapters

import android.content.Intent
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.example.messenger.UI.Chat
import com.example.messenger.data.local.entities.ChatEntity
import com.example.messenger.databinding.ItemChatBinding

class ChatAdapter(
    private val chats: List<ChatEntity>,
    private val currentUserId: Int
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
        holder.binding.ivReadStatus.setImageResource(com.example.messenger.R.drawable.check)

        holder.itemView.setOnClickListener {
            val intent = Intent(holder.itemView.context, Chat::class.java).apply {
                putExtra("currentUserId", currentUserId)
                putExtra("otherUsername", chat.partnerUsername ?: "")
            }
            holder.itemView.context.startActivity(intent)
        }
    }

    override fun getItemCount(): Int = chats.size
}