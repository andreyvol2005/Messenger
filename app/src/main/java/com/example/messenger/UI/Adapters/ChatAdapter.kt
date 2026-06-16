package com.example.messenger.UI.Adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.example.messenger.DataClasses.LS
import com.example.messenger.R
import com.example.messenger.databinding.ItemChatBinding
import android.graphics.drawable.ColorDrawable
import android.widget.LinearLayout
import android.widget.PopupWindow
import com.example.messenger.databinding.PopMenuBinding

class ChatAdapter(
    private val chats: List<LS>,
    private val currentUsername: String
) : RecyclerView.Adapter<ChatAdapter.ChatViewHolder>() {

    class ChatViewHolder(val binding: ItemChatBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ChatViewHolder {
        val binding = ItemChatBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ChatViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ChatViewHolder, position: Int) {
        val chat = chats[position]

        val companionName = chat.partnerNickname.ifEmpty {
            chat.members.find { it != currentUsername } ?: chat.members.firstOrNull() ?: "Unknown"
        }

        holder.binding.tvUsername.text = companionName
        holder.binding.tvnic.visibility = View.GONE
        holder.binding.tvLastMessage.text = chat.lastMsg

        if (chat.partnerAvatarUrl.isNotEmpty()) {
            Glide.with(holder.itemView.context)
                .load(chat.partnerAvatarUrl)
                .placeholder(R.drawable.ic_avatar_default)
                .into(holder.binding.ivAvatar)
        } else {
            holder.binding.ivAvatar.setImageResource(R.drawable.ic_avatar_default)
        }
        if (chat.lastSender == currentUsername) {
            when (chat.lastread) {
                0 -> holder.binding.ivReadStatus.setImageResource(R.drawable.check0)
                1 -> holder.binding.ivReadStatus.setImageResource(R.drawable.check1)
                2 -> holder.binding.ivReadStatus.setImageResource(R.drawable.check)
                else -> holder.binding.ivReadStatus.setImageResource(R.drawable.check)
            }
            holder.binding.flUnreadCount.visibility = View.GONE
            holder.binding.ivReadStatus.visibility = View.VISIBLE
        } else {
            if (chat.unread > 0) {
                holder.binding.flUnreadCount.visibility = View.VISIBLE
                holder.binding.tvUnreadCount.text = chat.unread.toString()
                holder.binding.ivReadStatus.visibility = View.GONE
            } else {
                holder.binding.flUnreadCount.visibility = View.GONE
                holder.binding.ivReadStatus.visibility = View.GONE
            }
        }

        holder.itemView.setOnClickListener {
//            db.collection("LS").document(chat.id).get()
//                .addOnSuccessListener { doc ->
//                    val members = doc.get("members") as? List<*> ?: emptyList<Any>()
//                    val userIndex = members.indexOf(currentUsername)
//                    val companionName = members.find { it != currentUsername } as? String ?: "Unknown"
//
//                    val intent = Intent(holder.itemView.context, Chat::class.java).apply {
//                        putExtra("chatId", chat.id)
//                        putExtra("chatTitle", companionName)
//                        putExtra("otherUsername", companionName)
//                        putExtra("currentUsername", currentUsername)
//                        putExtra("userIndex", userIndex)
//                    }
//                    holder.itemView.context.startActivity(intent)
//                }
        }

        holder.itemView.setOnLongClickListener { view ->
            showCustomPopupMenu(view, chat, holder)
            true
        }
    }

    private fun showCustomPopupMenu(anchor: View, chat: LS, holder: ChatViewHolder) {
        val binding = PopMenuBinding.inflate(LayoutInflater.from(anchor.context), null, false)
        val popupWindow = PopupWindow(
            binding.root,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            true
        )

        popupWindow.setBackgroundDrawable(ColorDrawable())

        popupWindow.showAsDropDown(anchor, 0, -anchor.height / 2)

        binding.tvDelete.setOnClickListener {
            deleteChat(chat, holder)
            popupWindow.dismiss()
        }
    }

    private fun deleteChat(chat: LS, holder: ChatViewHolder) {
        val chatId = chat.id
        val members = chat.members

//        db.collection("LS").document(chatId).delete()
//            .addOnSuccessListener {
//                for (member in members) {
//                    db.collection("Users").whereEqualTo("username", member).get()
//                        .addOnSuccessListener { users ->
//                            if (users.isEmpty()) return@addOnSuccessListener
//                            val userDoc = users.first()
//                            val currentChats = userDoc.get("chats") as? List<String> ?: emptyList()
//                            val updatedChats = currentChats.filter { it != chatId }
//                            userDoc.reference.update("chats", updatedChats)
//                        }
//                }
//            }
    }

    override fun getItemCount(): Int = chats.size
}