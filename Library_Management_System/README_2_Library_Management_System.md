# Library Management System (Intermediate)

**File:** `2_Intermediate_Library_Management_System.ipynb`
**Level:** Intermediate

A library system built using Object Oriented Programming. It manages books, members, issuing/returning books, and automatic fine calculation for late returns.

## What You'll Learn

- Classes and Objects (`Book`, `Member`, `Library`)
- Custom exceptions (`BookNotAvailableError`, `MemberNotFoundError`)
- File handling with JSON for data persistence
- Date and time handling (`datetime`, `timedelta`) for due dates and fines

## Features

- Add books and register members
- Issue a book to a member with a 7-day due date
- Return a book with automatic fine calculation (₹5/day late)
- View all books and members with their current status
- Clean error handling for invalid operations (e.g., issuing an already-issued book)

## Tech Stack

- Python 3
- `json`, `os`, `datetime` (standard library)

## How to Run

1. Download `2_Intermediate_Library_Management_System.ipynb`.
2. Open [Google Colab](https://colab.research.google.com/).
3. Upload the notebook (`File → Upload notebook`).
4. Run the cells in order (`Runtime → Run all`, or run cell by cell) to see the demo in action.

No installation needed — Colab already has everything required.

## Practice Exercises

1. **Easy:** Write a `search_book_by_title()` function that finds a book by its title.
2. **Medium:** Build a `most_popular_books()` function that tracks which book has been issued the most times.
3. **Hard:** Split the `Member` class into `Student` and `Faculty` using Inheritance — Faculty should not be charged a fine, and have a different issue limit.
