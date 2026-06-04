package com.example.messenger.Fragments

import android.app.Activity
import android.app.DatePickerDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import com.bumptech.glide.Glide
import com.example.messenger.MainActivity
import com.example.messenger.R
import com.example.messenger.Registration
import com.example.messenger.databinding.FragmentProfileBinding
import com.google.firebase.firestore.FirebaseFirestore
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.Calendar

class Profile : Fragment() {

    private var _binding: FragmentProfileBinding? = null
    private val binding get() = _binding!!

    private val db = FirebaseFirestore.getInstance()
    private val prefs by lazy { requireActivity().getSharedPreferences("app_prefs", android.content.Context.MODE_PRIVATE) }
    private var currentUsername: String = ""
    private var userDocId: String = ""
    private val API_KEY = "6d207e02198a847aa98d0a2a901485a5"

    private val PICK_IMAGE_REQUEST = 1000
    private val PERMISSION_REQUEST_CODE = 100
    private var userListener: com.google.firebase.firestore.ListenerRegistration? = null

    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        _binding = FragmentProfileBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        currentUsername = prefs.getString("user", "none") ?: "none"
        if (currentUsername == "none") {
            Toast.makeText(requireContext(), "Пользователь не авторизован", Toast.LENGTH_SHORT).show()
            return
        }

        loadUserProfile()

        binding.editAvatar.setOnClickListener {
            openImageChooser()
        }

        binding.editUsername.setOnClickListener {
            val currentValue = binding.tvUsername.text.toString()
            showEditDialog("Изменить username", currentValue) { newValue ->
                if (newValue.length < 3) {
                    Toast.makeText(requireContext(), "Username должен быть не менее 3 символов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue.length > 20) {
                    Toast.makeText(requireContext(), "Username должен быть не более 20 символов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (!newValue.matches(Regex("^[a-zA-Z0-9._]+$"))) {
                    Toast.makeText(requireContext(), "Username может содержать только буквы, цифры, . и _", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue == currentValue) {
                    return@showEditDialog
                }

                db.collection("Users").whereEqualTo("username", newValue).get()
                    .addOnSuccessListener { users ->
                        if (users.isEmpty()) {
                            updateUserField("username", newValue)
                            binding.tvDisplayName.text = newValue
                        } else {
                            Toast.makeText(requireContext(), "Пользователь с таким username уже существует", Toast.LENGTH_SHORT).show()
                        }
                    }
            }
        }

        binding.editNickname.setOnClickListener {
            val currentValue = binding.tvNickname.text.toString()
            showEditDialog("Изменить отображаемое имя", currentValue) { newValue ->
                if (newValue.isEmpty()) {
                    Toast.makeText(requireContext(), "Отображаемое имя не может быть пустым", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue.length > 30) {
                    Toast.makeText(requireContext(), "Отображаемое имя должно быть не более 30 символов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue.trim().isEmpty()) {
                    Toast.makeText(requireContext(), "Имя не может состоять только из пробелов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue == currentValue) {
                    return@showEditDialog
                }

                updateUserField("nickname", newValue)
                binding.tvDisplayName.text = newValue
            }
        }

        binding.editBio.setOnClickListener {
            val currentValue = binding.tvBio.text.toString()
            showEditDialog("Изменить описание", currentValue) { newValue ->
                if (newValue.length > 150) {
                    Toast.makeText(requireContext(), "Описание должно быть не более 150 символов", Toast.LENGTH_SHORT).show()
                    return@showEditDialog
                }
                if (newValue == currentValue) {
                    return@showEditDialog
                }

                val finalValue = if (newValue.isEmpty()) "Нет описания" else newValue
                updateUserField("bio", finalValue)
            }
        }

        binding.editBirthDate.setOnClickListener {
            showDatePickerDialog()
        }

        binding.btnLogout.setOnClickListener {
            prefs.edit().putString("user", "none").apply()
            val intent = Intent(requireContext(), Registration::class.java)
            intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            startActivity(intent)
            Toast.makeText(requireContext(), "Вы вышли из аккаунта", Toast.LENGTH_SHORT).show()
        }
    }

    private fun openImageChooser() {
        if (ContextCompat.checkSelfPermission(requireContext(), android.Manifest.permission.READ_MEDIA_IMAGES)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(requireActivity(),
                arrayOf(android.Manifest.permission.READ_MEDIA_IMAGES),
                PERMISSION_REQUEST_CODE)
        } else {
            val intent = Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
            intent.type = "image/*"
            startActivityForResult(intent, PICK_IMAGE_REQUEST)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                openImageChooser()
            } else {
                Toast.makeText(requireContext(), "Нужно разрешение для выбора изображения", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == PICK_IMAGE_REQUEST && resultCode == Activity.RESULT_OK && data != null) {
            val selectedImageUri = data.data
            selectedImageUri?.let { uri ->
                val filePath = getRealPathFromURI(uri)
                filePath?.let { path ->
                    uploadImageToHost(File(path))
                }
            }
        }
    }

    private fun getRealPathFromURI(contentUri: Uri): String? {
        val filePathColumn = arrayOf(MediaStore.Images.Media.DATA)
        val cursor: Cursor? = requireContext().contentResolver.query(contentUri, filePathColumn, null, null, null)
        cursor?.use {
            val columnIndex = it.getColumnIndexOrThrow(MediaStore.Images.Media.DATA)
            it.moveToFirst()
            return it.getString(columnIndex)
        }
        return null
    }

    private fun uploadImageToHost(imageFile: File) {
        if (_binding == null) return
        // Сжимаем изображение
        val compressedFile = compressImage(imageFile)

        Toast.makeText(requireContext(), "Загрузка изображения...", Toast.LENGTH_SHORT).show()

        val client = OkHttpClient()
        val mediaType = "image/*".toMediaType()
        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("key", API_KEY)
            .addFormDataPart("action", "upload")
            .addFormDataPart("source", compressedFile.name, compressedFile.asRequestBody(mediaType))
            .addFormDataPart("format", "json")
            .build()

        val request = Request.Builder()
            .url("https://freeimage.host/api/1/upload")
            .post(requestBody)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                requireActivity().runOnUiThread {
                    Toast.makeText(requireContext(), "Ошибка сети: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val responseBody = response.body?.string()
                requireActivity().runOnUiThread {
                    if (response.isSuccessful && responseBody != null) {
                        try {
                            val json = JSONObject(responseBody)
                            val imageUrl = json.optJSONObject("image")?.optString("url")
                            if (!imageUrl.isNullOrEmpty()) {
                                updateUserField("avatarUrl", imageUrl)
                                Glide.with(requireContext()).load(imageUrl).into(binding.ivAvatar)
                            } else {
                                Toast.makeText(requireContext(), "Не удалось получить ссылку", Toast.LENGTH_SHORT).show()
                            }
                        } catch (e: Exception) {
                            Toast.makeText(requireContext(), "Ошибка обработки: ${e.message}", Toast.LENGTH_SHORT).show()
                        }
                    } else {
                        Toast.makeText(requireContext(), "Ошибка загрузки", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    private fun compressImage(imageFile: File): File {
        val bitmap = BitmapFactory.decodeFile(imageFile.absolutePath)
        val outputStream = ByteArrayOutputStream()

        // Сжимаем до 80% качества
        bitmap.compress(Bitmap.CompressFormat.JPEG, 80, outputStream)

        val compressedFile = File(requireContext().cacheDir, "compressed_${System.currentTimeMillis()}.jpg")
        FileOutputStream(compressedFile).write(outputStream.toByteArray())

        return compressedFile
    }

    private fun loadUserProfile() {
        userListener = db.collection("Users")
            .whereEqualTo("username", currentUsername)
            .addSnapshotListener { users, error ->
                if (error != null || users == null || _binding == null) return@addSnapshotListener

                if (users.isEmpty()) {
                    Toast.makeText(requireContext(), "Пользователь не найден", Toast.LENGTH_SHORT).show()
                    return@addSnapshotListener
                }

                val userDoc = users.first()
                userDocId = userDoc.id
                val userData = userDoc.data

                val username = userData["username"] as? String ?: ""
                val nickname = userData["nickname"] as? String ?: ""
                val bio = userData["bio"] as? String ?: "Нет описания"
                val birthDate = userData["birthDate"] as? String ?: "Не указана"
                val avatarUrl = userData["avatarUrl"] as? String

                binding.tvDisplayName.text = nickname.ifEmpty { username }
                binding.tvUsername.text = username
                binding.tvNickname.text = nickname.ifEmpty { "Не указано" }
                binding.tvBio.text = bio
                binding.tvBirthDate.text = birthDate
            }
    }

    private fun showEditDialog(title: String, currentValue: String, onSave: (String) -> Unit) {
        val input = EditText(requireContext()).apply {
            setText(currentValue)
            hint = "Введите новое значение"
        }

        AlertDialog.Builder(requireContext())
            .setTitle(title)
            .setView(input)
            .setPositiveButton("Сохранить") { _, _ ->
                val newValue = input.text.toString().trim()
                if (newValue.isNotEmpty() && newValue != currentValue) {
                    onSave(newValue)
                } else if (newValue.isEmpty()) {
                    Toast.makeText(requireContext(), "Поле не может быть пустым", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun showDatePickerDialog() {
        if (_binding == null) return
        val calendar = Calendar.getInstance()
        val currentDate = binding.tvBirthDate.text.toString()

        if (currentDate != "Не указана" && currentDate != "...") {
            try {
                val parts = currentDate.split(".")
                if (parts.size == 3) {
                    calendar.set(parts[2].toInt(), parts[1].toInt() - 1, parts[0].toInt())
                }
            } catch (e: Exception) { }
        }

        DatePickerDialog(
            requireContext(),
            { _, year, month, dayOfMonth ->
                val newDate = String.format("%02d.%02d.%d", dayOfMonth, month + 1, year)
                updateUserField("birthDate", newDate)
            },
            calendar.get(Calendar.YEAR),
            calendar.get(Calendar.MONTH),
            calendar.get(Calendar.DAY_OF_MONTH)
        ).show()
    }

    private fun updateUserField(field: String, value: String) {
        db.collection("Users").document(userDocId)
            .update(field, value)
            .addOnSuccessListener {
                Toast.makeText(requireContext(), "Обновлено", Toast.LENGTH_SHORT).show()
            }
            .addOnFailureListener {
                Toast.makeText(requireContext(), "Ошибка обновления", Toast.LENGTH_SHORT).show()
            }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        userListener?.remove()
        userListener = null
        _binding = null
    }
}