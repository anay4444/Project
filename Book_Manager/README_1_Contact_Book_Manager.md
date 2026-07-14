# Contact Book Manager (Beginner)

**File:** `1_Beginner_Contact_Book_Manager.ipynb`
**Level:** Beginner

A command-line contact book that lets you add, view, search, and delete contacts. All data is saved permanently to a local JSON file, so contacts persist between sessions.

## What You'll Learn

- Working with Python dictionaries and lists
- Writing and calling functions
- Saving and loading data using the `json` module
- Basic error handling with `try-except`

## Features

- Add a new contact (name, phone, email)
- View all saved contacts
- Search a contact by name
- Delete a contact
- Menu-driven interface with a `while` loop

## Tech Stack

- Python 3
- `json`, `os` (standard library)

## How to Run

1. Download `1_Beginner_Contact_Book_Manager.ipynb`.
2. Open [Google Colab](https://colab.research.google.com/).
3. Upload the notebook (`File → Upload notebook`).
4. Run the cells in order (`Runtime → Run all`, or run cell by cell).
5. To use the interactive menu, uncomment the `main()` line in the last code cell and run it.

No installation needed — Colab already has everything required.

## Practice Exercises

1. **Easy:** Write a function to update an existing contact's phone/email.
2. **Medium:** Add a duplicate phone number check — warn the user if the same number already exists under a different name.
3. **Hard:** Sort contacts alphabetically by name before displaying them, and add an "export to CSV" feature.
