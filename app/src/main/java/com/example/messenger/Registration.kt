package com.example.messenger

import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.example.messenger.databinding.ActivityRegistrationBinding
import com.google.firebase.firestore.FirebaseFirestore

class Registration : AppCompatActivity() {

    private lateinit var binding: ActivityRegistrationBinding
    private val db = FirebaseFirestore.getInstance()
    private val prefs by lazy { getSharedPreferences("app_prefs", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityRegistrationBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val savedUsername = prefs.getString("user", "none")
        if (savedUsername != "none") {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
        }

        binding.btnRegister.setOnClickListener {
            val username = binding.etUsername.text.toString()
            val password = binding.etPassword.text.toString()

            if (username.length < 3) {
                Toast.makeText(this, "Username должен быть не менее 3 символов", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (username.length > 20) {
                Toast.makeText(this, "Username должен быть не более 20 символов", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (!username.matches(Regex("^[a-zA-Z0-9._]+$"))) {
                Toast.makeText(this, "Username может содержать только буквы, цифры, . и _", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            if (password.length < 3) {
                Toast.makeText(this, "Пароль должен быть не менее 3 символов", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (password.length > 10) {
                Toast.makeText(this, "Пароль должен быть не более 10 символов", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (username.isNotEmpty() && password.isNotEmpty()) {
                db.collection("Users")
                    .whereEqualTo("username", username)
                    .get()
                    .addOnSuccessListener { users ->
                        if (users.isEmpty()) {
                            val userData = hashMapOf("username" to username, "password" to password)
                            db.collection("Users").add(userData)
                                .addOnSuccessListener {
                                    prefs.edit().putString("user", username).apply()
                                    startActivity(Intent(this, MainActivity::class.java))
                                    finish()
                                }
                        } else {
                            Toast.makeText(this, "Пользователь уже существует", Toast.LENGTH_SHORT).show()
                        }
                    }
            } else {
                Toast.makeText(this, "Заполните все поля", Toast.LENGTH_SHORT).show()
            }
        }

        binding.btnLogin.setOnClickListener {
            val username = binding.etUsername.text.toString()
            val password = binding.etPassword.text.toString()
                if (username.isNotEmpty() && password.isNotEmpty()) {
                db.collection("Users")
                    .whereEqualTo("username", username)
                    .whereEqualTo("password", password)
                    .get()
                    .addOnSuccessListener { users ->
                        if (users.isEmpty()) {
                            Toast.makeText(this, "Неверный логин или пароль", Toast.LENGTH_SHORT).show()
                        } else {
                            prefs.edit().putString("user", username).apply()
                            startActivity(Intent(this, MainActivity::class.java))
                            finish()
                        }
                    }
            } else {
                Toast.makeText(this, "Введите никнейм и пароль ${username} ${password}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}