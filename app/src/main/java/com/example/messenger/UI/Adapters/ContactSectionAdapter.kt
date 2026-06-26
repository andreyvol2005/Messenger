package com.example.messenger.UI.Adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.messenger.R
import com.example.messenger.data.local.entities.ContactEntity
import com.example.messenger.databinding.ItemDialogContactBinding

class ContactSectionAdapter(
    private val sections: List<Pair<String, List<ContactEntity>>>,
    private val onItemClick: (ContactEntity) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        private const val TYPE_HEADER = 0
        private const val TYPE_CONTACT = 1
    }

    private val flatList = buildFlatList()

    private fun buildFlatList(): List<Any> {
        val result = mutableListOf<Any>()
        for ((letter, contacts) in sections) {
            result.add(letter)
            result.addAll(contacts)
        }
        return result
    }

    override fun getItemViewType(position: Int): Int {
        return if (flatList[position] is String) TYPE_HEADER else TYPE_CONTACT
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        return if (viewType == TYPE_HEADER) {
            val tv = TextView(parent.context).apply {
                setPadding(16, 16, 16, 4)
                textSize = 14f
                setTextColor(parent.context.getColor(android.R.color.darker_gray))
                typeface = android.graphics.Typeface.DEFAULT_BOLD
            }
            HeaderViewHolder(tv)
        } else {
            val binding = ItemDialogContactBinding.inflate(
                LayoutInflater.from(parent.context), parent, false
            )
            ContactViewHolder(binding, onItemClick)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val item = flatList[position]

        when (holder) {
            is HeaderViewHolder -> {
                holder.bind(item as String)
            }
            is ContactViewHolder -> {
                holder.bind(item as ContactEntity)
            }
        }
    }

    override fun getItemCount(): Int = flatList.size

    class HeaderViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val tvHeader: TextView = itemView as TextView

        fun bind(letter: String) {
            tvHeader.text = letter
        }
    }

    class ContactViewHolder(
        private val binding: ItemDialogContactBinding,
        private val onItemClick: (ContactEntity) -> Unit
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(contact: ContactEntity) {
            binding.tvUsername.text = contact.nickname
            binding.ivAvatar.setImageResource(R.drawable.ic_avatar_default)

            binding.root.setOnClickListener {
                onItemClick(contact)
            }
        }
    }
}