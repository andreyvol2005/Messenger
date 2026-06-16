package com.example.messenger.UI.Adapters

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.recyclerview.widget.RecyclerView
import com.example.messenger.DataClasses.Message
import com.example.messenger.databinding.ItemMessageBinding
import android.graphics.drawable.ColorDrawable
import android.widget.LinearLayout
import android.widget.PopupWindow
import com.example.messenger.UI.Chat
import com.example.messenger.R
import com.example.messenger.databinding.PupMenuMessageBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MessagesAdapter(
    private val messages: List<Message>,
    private val currentUserIndex: Int,
    private val chatId: String,
    private val otherUserNickname: String
) : RecyclerView.Adapter<MessagesAdapter.MessageViewHolder>() {


    class MessageViewHolder(val binding: ItemMessageBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder {
        val binding = ItemMessageBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return MessageViewHolder(binding)
    }

    override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
        val message = messages[position]
        val isMyMessage = message.from == currentUserIndex

        holder.binding.tvMessageSender.textSize = 18f
        holder.binding.tvMessageReceiver.textSize = 18f

        if (isMyMessage) {
            holder.binding.llSender.visibility = View.GONE
            holder.binding.llReceiver.visibility = View.VISIBLE
            holder.binding.tvMessageReceiver.text = message.text
            holder.binding.tvTimeReceiver.text = formatTime(message.time)

            if (message.replyToId.isNotEmpty()) {
                loadReplyData(message.replyToId, holder, isMyMessage) { replyText ->
                    setContainerWidth(holder.binding.replyContainerReceiver, replyText, message.text)
                }
            } else {
                holder.binding.replyContainerReceiver.visibility = View.GONE
            }

            when (message.read) {
                0 -> holder.binding.ivReadStatus.setImageResource(R.drawable.check0)
                1 -> holder.binding.ivReadStatus.setImageResource(R.drawable.check1)
                2 -> holder.binding.ivReadStatus.setImageResource(R.drawable.check)
            }
        } else {
            holder.binding.llSender.visibility = View.VISIBLE
            holder.binding.llReceiver.visibility = View.GONE
            holder.binding.tvMessageSender.text = message.text
            holder.binding.tvTimeSender.text = formatTime(message.time)

            if (message.replyToId.isNotEmpty()) {
                loadReplyData(message.replyToId, holder, isMyMessage) { replyText ->
                    setContainerWidth(holder.binding.replyContainerSender, replyText, message.text)
                }
            } else {
                holder.binding.replyContainerSender.visibility = View.GONE
            }
        }

        val clickableView = if (isMyMessage) holder.binding.llReceiver else holder.binding.llSender
        clickableView.setOnLongClickListener {
            showCustomPopupMenu(it, message, holder)
            true
        }
    }

    private fun setContainerWidth(container: LinearLayout, replyText: String, messageText: String) {
        val replyLength = replyText.length
        val messageLength = messageText.length

        if (replyLength + 3 > messageLength) {
            container.layoutParams.width = LinearLayout.LayoutParams.WRAP_CONTENT
        } else {
            container.layoutParams.width = LinearLayout.LayoutParams.MATCH_PARENT
        }
        container.requestLayout()
    }

    private fun loadReplyData(replyToId: String, holder: MessageViewHolder, isMyMessage: Boolean, onResult: (String) -> Unit) {
//        db.collection("LS").document(chatId)
//            .collection("messages").document(replyToId)
//            .get()
//            .addOnSuccessListener { doc ->
//                val repliedMessage = doc.toObject(Message::class.java)
//                if (repliedMessage != null) {
//                    val replyText = repliedMessage.text
//                    val senderName = if (repliedMessage.from == currentUserIndex) {
//                        "Вы"
//                    } else {
//                        otherUserNickname
//                    }
//
//                    if (isMyMessage) {
//                        holder.binding.replyContainerReceiver.visibility = View.VISIBLE
//                        holder.binding.tvReplyReceiverName.text = senderName
//                        holder.binding.tvReplyTextReceiver.text = replyText
//                    } else {
//                        holder.binding.replyContainerSender.visibility = View.VISIBLE
//                        holder.binding.tvReplySenderName.text = senderName
//                        holder.binding.tvReplyTextSender.text = replyText
//                    }
//
//                    onResult(replyText)
//                }
//            }
    }

    private fun showCustomPopupMenu(anchor: View, message: Message, holder: MessageViewHolder) {
        val binding = PupMenuMessageBinding.inflate(LayoutInflater.from(anchor.context), null, false)
        val popupWindow = PopupWindow(
            binding.root,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
            true
        )

        popupWindow.setBackgroundDrawable(ColorDrawable())
        popupWindow.showAsDropDown(anchor, 0, -anchor.height / 2)

        binding.tvReply.setOnClickListener {
            val senderName = if (message.from == currentUserIndex) { "Вы" } else { otherUserNickname }
            (holder.itemView.context as? Chat)?.showReplyBar(senderName, message.text, message.id)
            popupWindow.dismiss()
        }

        binding.tvCopy.setOnClickListener {
            copyToClipboard(message.text, holder)
            popupWindow.dismiss()
        }

        binding.tvDelete.setOnClickListener {
            deleteMessage(message, holder)
            popupWindow.dismiss()
        }
    }

    private fun copyToClipboard(text: String, holder: MessageViewHolder) {
        val clipboard = holder.itemView.context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("message", text))
        Toast.makeText(holder.itemView.context, "Скопировано", Toast.LENGTH_SHORT).show()
    }

    private fun deleteMessage(message: Message, holder: MessageViewHolder) {
        if (message.id.isNotEmpty()) {
//            db.collection("LS").document(chatId)
//                .collection("messages").document(message.id)
//                .delete()
//                .addOnSuccessListener {
//                    Toast.makeText(holder.itemView.context, "Сообщение удалено", Toast.LENGTH_SHORT).show()
//                }
//                .addOnFailureListener {
//                    Toast.makeText(holder.itemView.context, "Ошибка удаления", Toast.LENGTH_SHORT).show()
//                }
        }
    }

    override fun getItemCount(): Int = messages.size

    private fun formatTime(timeString: String): String {
        return if (timeString.isNotEmpty()) {
            try {
                val timestamp = timeString.toLong()
                val date = Date(timestamp)
                val format = SimpleDateFormat("HH:mm", Locale.getDefault())
                format.format(date)
            } catch (e: NumberFormatException) {
                ""
            }
        } else { "" }
    }
}