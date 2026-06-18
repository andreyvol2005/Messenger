package com.example.messenger.data.local.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import com.example.messenger.data.local.database.dao.ChatDao
import com.example.messenger.data.local.database.dao.ContactDao
import com.example.messenger.data.local.database.dao.UserDao
import com.example.messenger.data.local.entities.ChatEntity
import com.example.messenger.data.local.entities.ContactEntity
import com.example.messenger.data.local.entities.UserEntity

@Database(
    entities = [
        UserEntity::class,
        ContactEntity::class,
        ChatEntity::class
    ],
    version = 3,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun userDao(): UserDao
    abstract fun contactDao(): ContactDao
    abstract fun chatDao(): ChatDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getDatabase(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "messenger_database"
                )
                .fallbackToDestructiveMigration()
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}