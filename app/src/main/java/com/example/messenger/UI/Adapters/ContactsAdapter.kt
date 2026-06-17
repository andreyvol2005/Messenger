package com.example.messenger.UI.Adapters

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
//import com.example.messenger.Adapters.Contact
import com.example.messenger.R
import com.example.messenger.databinding.ItemContactBinding

class ContactsAdapter(
//    private val contacts: List<Contact>,
    private val currentUsername: String,
//    private val onItemClick: (Contact) -> Unit
) : RecyclerView.Adapter<ContactsAdapter.ContactViewHolder>() {

    class ContactViewHolder(val binding: ItemContactBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ContactViewHolder {
        val binding = ItemContactBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ContactViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ContactViewHolder, position: Int) {
//        val contact = contacts[position]
//        holder.binding.tvUsername.text = contact.displayName
//
//        if (contact.avatarUrl.isNotEmpty()) {
//            Glide.with(holder.itemView.context)
//                .load(contact.avatarUrl)
//                .placeholder(R.drawable.ic_avatar_default)
//                .into(holder.binding.ivAvatar)
//        } else {
//            holder.binding.ivAvatar.setImageResource(R.drawable.ic_avatar_default)
//        }
//
//        holder.itemView.setOnClickListener {
//            onItemClick(contact)
//        }
    }

    override fun getItemCount(): Int = 1
}