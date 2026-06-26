package com.example.messenger.UI.Adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.example.messenger.R
import com.example.messenger.data.local.entities.MessageEntity
import com.example.messenger.databinding.ItemMessageBinding

class MessagesAdapter(
    private val messages: List<MessageEntity>,
    private val currentUserId: Int
) : RecyclerView.Adapter<MessagesAdapter.MessageViewHolder>() {

    class MessageViewHolder(val binding: ItemMessageBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder {
        val binding = ItemMessageBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return MessageViewHolder(binding)
    }

    override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
        val message = messages[position]
        val isMine = message.senderId == currentUserId

        if (isMine) {
            holder.binding.llReceiver.visibility = View.VISIBLE
            holder.binding.llSender.visibility = View.GONE
            holder.binding.tvMessageReceiver.text = message.text
        } else {
            holder.binding.llSender.visibility = View.VISIBLE
            holder.binding.llReceiver.visibility = View.GONE
            holder.binding.tvMessageSender.text = message.text
        }
    }

    override fun getItemCount(): Int = messages.size
}