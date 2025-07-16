"""
Flask web application for OpenTale
"""

import json
import os
import re

from flask import (
    Flask,
    Response,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    stream_with_context,
)

import prompts
from agents import PROMPT_DEBUGGING_DIR, BookAgents, check_openai_connection
from config import get_config

app = Flask(__name__)


# Constants for file paths
BOOK_OUTPUT_DIR = "book_output"
TEXT_EXTENSION = ".txt"
WORLD_FILE = os.path.join(BOOK_OUTPUT_DIR, f"world{TEXT_EXTENSION}")
CHARACTERS_FILE = os.path.join(BOOK_OUTPUT_DIR, f"characters{TEXT_EXTENSION}")
OUTLINE_FILE = os.path.join(BOOK_OUTPUT_DIR, f"outline{TEXT_EXTENSION}")
CHAPTERS_JSON_FILE = os.path.join(BOOK_OUTPUT_DIR, "chapters.json")
MASTER_PROMPT_FILE = os.path.join(BOOK_OUTPUT_DIR, f"master_prompt{TEXT_EXTENSION}")
SETTINGS_FILE = os.path.join(BOOK_OUTPUT_DIR, "settings.json")
OUTLINE_JSON_FILE = os.path.join(BOOK_OUTPUT_DIR, "outline.json")
CHAPTERS_DIR = os.path.join(BOOK_OUTPUT_DIR, "chapters")
PREVIOUS_CHAPTER_CONTEXT_LENGTH = 2000


# Ensure book_output directory exists
os.makedirs(CHAPTERS_DIR, exist_ok=True)

# Initialize global variables
agent_config = get_config()


# Helper functions to read data from files
def get_world_theme():
    """Get world theme from file."""
    if os.path.exists(WORLD_FILE):
        with open(WORLD_FILE, "r") as f:
            return f.read().strip()
    return ""


def get_characters():
    """Get characters from file."""
    if os.path.exists(CHARACTERS_FILE):
        with open(CHARACTERS_FILE, "r") as f:
            return f.read().strip()
    return ""


def get_outline():
    """Get outline from file."""
    if os.path.exists(OUTLINE_FILE):
        with open(OUTLINE_FILE, "r") as f:
            return f.read().strip()
    return ""


def get_chapters():
    """Get chapters from file, including a flag if content exists."""
    chapters = []
    if os.path.exists(CHAPTERS_JSON_FILE):
        with open(CHAPTERS_JSON_FILE, "r") as f:
            try:
                chapters = json.load(f)
            except json.JSONDecodeError:
                chapters = []

    # Add 'has_content' and 'has_been_reviewed' flags to each chapter
    for chapter in chapters:
        chapter_file_path = os.path.join(
            CHAPTERS_DIR, f"chapter_{chapter['chapter_number']}{TEXT_EXTENSION}"
        )
        chapter["has_content"] = (
            os.path.exists(chapter_file_path) and os.path.getsize(chapter_file_path) > 0
        )
        editor_chapter_file_path = os.path.join(
            CHAPTERS_DIR, f"chapter_{chapter['chapter_number']}_editor{TEXT_EXTENSION}"
        )
        chapter["has_been_reviewed"] = (
            os.path.exists(editor_chapter_file_path)
            and os.path.getsize(editor_chapter_file_path) > 0
        )
    return chapters


def get_action_beats(chapter_number):
    """Get action beats for a specific chapter from file."""
    action_beats_path = os.path.join(
        CHAPTERS_DIR, f"chapter_{chapter_number}_action_beats{TEXT_EXTENSION}"
    )
    if os.path.exists(action_beats_path):
        with open(action_beats_path, "r") as f:
            return f.read().strip()
    return ""


def get_master_prompt():
    """Get master prompt from file."""
    if os.path.exists(MASTER_PROMPT_FILE):
        with open(MASTER_PROMPT_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


def get_settings():
    """Get settings from file."""
    if os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return {}
    return {}


def save_settings(settings):
    """Save settings to file."""
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2)


@app.route("/")
def index():
    """Render the home page"""
    return render_template("index.html")


@app.route("/world", methods=["GET"])
def world():
    """Display world theme or chat interface"""
    # GET request - show world page with existing theme if available
    world_theme = get_world_theme()
    settings = get_settings()
    return render_template(
        "world.html", world_theme=world_theme, topic=settings.get("topic", "")
    )


@app.route("/world_chat", methods=["POST"])
def world_chat():
    """Handle ongoing chat for world building"""
    data = request.json
    user_message = data.get("message", "")
    chat_history = data.get("chat_history", [])
    topic = data.get("topic", "")

    # Save topic to settings if available
    if topic:
        settings = get_settings()
        settings["topic"] = topic
        save_settings(settings)

    # Initialize agents for world building
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(topic, 0)

    # Generate response using the direct chat method
    ai_response = book_agents.generate_chat_response(chat_history, topic, user_message)

    # Clean the response
    ai_response = ai_response.strip()

    return jsonify({"message": ai_response})


@app.route("/world_chat_stream", methods=["POST"])
def world_chat_stream():
    """Handle ongoing chat for world building with streaming response"""
    data = request.json
    user_message = data.get("message", "")
    chat_history = data.get("chat_history", [])
    topic = data.get("topic", "")

    # Save topic to settings if available
    if topic:
        settings = get_settings()
        settings["topic"] = topic
        save_settings(settings)

    # Initialize agents for world building
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(topic, 0)

    # Generate streaming response
    stream = book_agents.generate_chat_response_stream(
        chat_history, topic, user_message
    )

    def generate():
        # Send a heartbeat to establish the connection
        yield 'data: {"content": ""}\n\n'

        # Iterate through the stream to get each chunk
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                # Send each token as it arrives
                yield f"data: {json.dumps({'content': content})}\n\n"

        # Send completion marker
        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/finalize_world", methods=["POST"])
def finalize_world():
    """Finalize the world setting based on chat history"""
    data = request.json
    chat_history = data.get("chat_history", [])
    topic = data.get("topic", "")

    # Initialize agents for world building
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(topic, 0)

    # Generate the final world setting using the direct method
    world_theme = book_agents.generate_final_world(chat_history, topic)

    # Clean and save world theme to file
    world_theme = world_theme.strip()
    world_theme = re.sub(r"\n+", "\n", world_theme.strip())

    with open(WORLD_FILE, "w") as f:
        f.write(world_theme)

    return jsonify({"world_theme": world_theme})


@app.route("/finalize_world_stream", methods=["POST"])
def finalize_world_stream():
    """Finalize the world setting based on chat history with streaming response"""
    data = request.json
    chat_history = data.get("chat_history", [])
    topic = data.get("topic", "")

    # Initialize agents for world building
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(topic, 0)

    # Generate the final world setting using streaming
    stream = book_agents.generate_final_world_stream(chat_history, topic)

    def generate():
        # Send a heartbeat to establish the connection
        yield 'data: {"content": ""}\n\n'

        # Collect all chunks to save the complete response
        collected_content = []

        # Iterate through the stream to get each chunk
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                collected_content.append(content)
                # Send each token as it arrives
                yield f"data: {json.dumps({'content': content})}\n\n"

        # Combine all chunks for the complete content
        complete_content = "".join(collected_content)

        # Clean and save world theme to file once streaming is complete
        world_theme = complete_content.strip()
        world_theme = re.sub(r"\n+", "\n", world_theme)

        with open(WORLD_FILE, "w") as f:
            f.write(world_theme)

        # Send completion marker
        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/save_world", methods=["POST"])
def save_world():
    """Save edited world theme"""
    world_theme = request.form.get("world_theme")
    world_theme = world_theme.replace("\r\n", "\n")
    world_theme = re.sub(r"\n{2,}", "\n\n", world_theme)

    # Strip extra newlines at the beginning and normalize newlines
    world_theme = world_theme.strip()
    world_theme = re.sub(r"\n+", "\n", world_theme.strip())

    # Save to file
    with open(WORLD_FILE, "w") as f:
        f.write(world_theme)

    return jsonify({"success": True})


@app.route("/characters", methods=["GET"])
def characters():
    """Display characters or character creation chat interface"""
    # GET request - show characters page with existing characters if available
    characters_content = get_characters()

    # Load world theme from file
    world_theme = get_world_theme()

    settings = get_settings()
    num_characters = settings.get("num_characters", 3)

    return render_template(
        "characters.html",
        characters=characters_content,
        world_theme=world_theme,
        num_characters=num_characters,
    )


@app.route("/save_characters", methods=["POST"])
def save_characters():
    """Save edited characters"""
    characters_content = request.form.get("characters")
    characters_content = characters_content.replace("\r\n", "\n")
    characters_content = re.sub(r"\n{2,}", "\n\n", characters_content)

    # Strip extra newlines at the beginning and normalize newlines
    characters_content = characters_content.strip()

    # Save to file
    with open(CHARACTERS_FILE, "w") as f:
        f.write(characters_content)

    return jsonify({"success": True})


@app.route("/outline", methods=["GET", "POST"])
def outline():
    # Check if world theme and characters exist
    if not os.path.exists(WORLD_FILE):
        flash("You need to create a world setting first.", "warning")
        return redirect("/world")

    if not os.path.exists(CHARACTERS_FILE):
        flash("You need to create characters first.", "warning")
        return redirect("/characters")

    # Get world theme and characters
    with open(WORLD_FILE, "r") as f:
        world_theme = f.read()

    with open(CHARACTERS_FILE, "r") as f:
        characters = f.read()

    # GET request - just show the page
    outline_content = ""
    if os.path.exists(OUTLINE_FILE):
        with open(OUTLINE_FILE, "r") as f:
            outline_content = f.read()

    # Get chapter list
    chapters = get_chapters()

    settings = get_settings()
    num_chapters = settings.get("num_chapters", 20)

    return render_template(
        "outline.html",
        world_theme=world_theme,
        characters=characters,
        outline=outline_content,
        chapters=chapters,
        num_chapters=num_chapters,
    )


@app.route("/chapters", methods=["GET"])
def chapters_list():
    """Display the list of chapters"""
    chapters = get_chapters()
    return render_template("chapters.html", chapters=chapters)


@app.route("/generate_chapters", methods=["POST"])
def generate_chapters():
    """Generate chapters structure from existing outline"""
    # Check if we have an outline
    if not os.path.exists(OUTLINE_FILE):
        return jsonify({"error": "Outline not found. Please create an outline first."})

    # Get the outline content
    with open(OUTLINE_FILE, "r") as f:
        outline_content = f.read()

    # Get the desired number of chapters
    num_chapters = int(request.form.get("num_chapters", 10))

    # Parse the outline into chapters
    chapters = parse_outline_to_chapters(outline_content, num_chapters)

    # Save chapters to file
    with open(CHAPTERS_JSON_FILE, "w") as f:
        json.dump(chapters, f, indent=2)

    return jsonify({"success": True, "num_chapters": len(chapters)})


@app.route("/save_outline", methods=["POST"])
def save_outline():
    """Save edited outline and generate chapters structure"""
    outline_content = request.form.get("outline")
    outline_content = outline_content.replace("\r\n", "\n")
    outline_content = re.sub(r"\n{2,}", "\n\n", outline_content)

    # Strip extra newlines at the beginning and normalize newlines
    outline_content = outline_content.strip()

    # Save to file
    with open(OUTLINE_FILE, "w") as f:
        f.write(outline_content)

    # Generate and save chapters
    num_chapters = int(request.form.get("num_chapters", 10))
    chapters = parse_outline_to_chapters(outline_content, num_chapters)

    # Save chapters to file
    with open(CHAPTERS_JSON_FILE, "w") as f:
        json.dump(chapters, f, indent=2)

    return jsonify({"success": True, "num_chapters": len(chapters)})


@app.route("/chapter/<int:chapter_number>", methods=["GET", "POST"])
def chapter(chapter_number):
    """Generate or display a specific chapter"""
    chapters = get_chapters()

    # Check if chapter exists
    chapter_data = None
    for ch in chapters:
        if ch["chapter_number"] == chapter_number:
            chapter_data = ch
            break

    if not chapter_data:
        return render_template(
            "error.html", message=f"Chapter {chapter_number} not found"
        )

    settings = get_settings()

    if request.method == "POST":
        # Get any additional context from the chat interface
        additional_context = request.form.get("additional_context", "")
        master_prompt = request.form.get("master_prompt", "")
        point_of_view = request.form.get("point_of_view", "Third-person limited")
        tense = request.form.get("tense", "Past tense")
        action_beats = request.form.get("action_beats_content", "")

        # Save to settings
        settings_to_save = get_settings()
        if "chapters" not in settings_to_save:
            settings_to_save["chapters"] = {}
        if str(chapter_number) not in settings_to_save["chapters"]:
            settings_to_save["chapters"][str(chapter_number)] = {}

        settings_to_save["chapters"][str(chapter_number)]["point_of_view"] = (
            point_of_view
        )
        settings_to_save["chapters"][str(chapter_number)]["tense"] = tense
        save_settings(settings_to_save)

        # Generate chapter content
        world_theme = get_world_theme()
        characters = get_characters()

        # Get previous chapters context
        previous_context = ""
        if chapter_number > 1:
            prev_chapter_path = os.path.join(
                CHAPTERS_DIR, f"chapter_{chapter_number - 1}{TEXT_EXTENSION}"
            )
            if os.path.exists(prev_chapter_path):
                with open(prev_chapter_path, "r") as f:
                    # Get a summary or the last few paragraphs
                    content = f.read()
                    previous_context = content[-PREVIOUS_CHAPTER_CONTEXT_LENGTH:]

        # Initialize agents for chapter generation
        book_agents = BookAgents(agent_config, chapters)
        book_agents.create_agents(world_theme, len(chapters))

        # Add the additional context from chat to the chapter prompt
        chapter_prompt = (
            f"{chapter_data['prompt']}\n\n{additional_context}"
            if additional_context
            else chapter_data["prompt"]
        )

        # Generate the chapter
        chapter_content = book_agents.generate_content(
            "writer",
            prompts.CHAPTER_GENERATION_PROMPT.format(
                master_prompt=master_prompt,
                chapter_number=chapter_number,
                chapter_title=chapter_data["title"],
                chapter_outline=chapter_prompt,
                world_theme=world_theme,
                relevant_characters=characters,  # You might want to filter for relevant characters only
                scene_details="",  # This would be filled if scenes were generated first
                action_beats=action_beats,
                previous_context=previous_context,
                point_of_view=point_of_view,
                tense=tense,
            ),
        )

        # Clean and save chapter content
        chapter_content = chapter_content.strip()
        chapter_path = os.path.join(
            CHAPTERS_DIR, f"chapter_{chapter_number}{TEXT_EXTENSION}"
        )
        with open(chapter_path, "w") as f:
            f.write(chapter_content)

        return jsonify({"chapter_content": chapter_content})

    # GET request - show chapter page with existing content if available
    chapter_content = ""
    chapter_path = os.path.join(
        CHAPTERS_DIR, f"chapter_{chapter_number}{TEXT_EXTENSION}"
    )
    if os.path.exists(chapter_path):
        with open(chapter_path, "r") as f:
            chapter_content = f.read().strip()

    master_prompt = get_master_prompt()

    action_beats_path = os.path.join(
        CHAPTERS_DIR, f"chapter_{chapter_number}_action_beats{TEXT_EXTENSION}"
    )
    action_beats_content = ""
    if os.path.exists(action_beats_path):
        with open(action_beats_path, "r") as f:
            action_beats_content = f.read()

    # Get chapter-specific settings or defaults
    chapter_settings = settings.get("chapters", {}).get(str(chapter_number), {})
    point_of_view = chapter_settings.get("point_of_view", "Third-person limited")
    tense = chapter_settings.get("tense", "Past tense")

    return render_template(
        "chapter.html",
        chapter=chapter_data,
        chapter_content=chapter_content,
        action_beats_content=action_beats_content,
        chapters=chapters,  # Pass the full chapters list for total count
        master_prompt=master_prompt,
        point_of_view=point_of_view,
        tense=tense,
    )


@app.route("/chapter_stream/<int:chapter_number>", methods=["POST"])
def chapter_stream(chapter_number):
    """Generate or display a specific chapter"""
    chapters = get_chapters()

    # Check if chapter exists
    chapter_data = None
    for ch in chapters:
        if ch["chapter_number"] == chapter_number:
            chapter_data = ch
            break

    if not chapter_data:
        return Response(
            json.dumps({"error": f"Chapter {chapter_number} not found"}),
            status=404,
            mimetype="application/json",
        )

    # Get any additional context from the chat interface
    data = request.json
    additional_context = data.get("additional_context", "")
    master_prompt = data.get("master_prompt", "")
    point_of_view = data.get("point_of_view", "Third-person limited")
    tense = data.get("tense", "Past tense")
    action_beats = data.get("action_beats_content", "")

    # Save to settings
    settings_to_save = get_settings()
    if "chapters" not in settings_to_save:
        settings_to_save["chapters"] = {}
    if str(chapter_number) not in settings_to_save["chapters"]:
        settings_to_save["chapters"][str(chapter_number)] = {}

    settings_to_save["chapters"][str(chapter_number)]["point_of_view"] = point_of_view
    settings_to_save["chapters"][str(chapter_number)]["tense"] = tense
    save_settings(settings_to_save)

    # Generate chapter content
    world_theme = get_world_theme()
    characters = get_characters()

    # Get previous chapters context
    previous_context = ""
    if chapter_number > 1:
        prev_chapter_path = os.path.join(
            CHAPTERS_DIR, f"chapter_{chapter_number - 1}{TEXT_EXTENSION}"
        )
        if os.path.exists(prev_chapter_path):
            with open(prev_chapter_path, "r") as f:
                # Get a summary or the last few paragraphs
                content = f.read()
                previous_context = content[-PREVIOUS_CHAPTER_CONTEXT_LENGTH:]

    # Initialize agents for chapter generation
    book_agents = BookAgents(agent_config, chapters)
    book_agents.create_agents(world_theme, len(chapters))

    # Add the additional context from chat to the chapter prompt
    chapter_prompt = (
        f"{chapter_data['prompt']}\n\n{additional_context}"
        if additional_context
        else chapter_data["prompt"]
    )

    # Generate the chapter
    stream = book_agents.generate_content_stream(
        "writer",
        prompts.CHAPTER_GENERATION_PROMPT.format(
            master_prompt=master_prompt,
            chapter_number=chapter_number,
            chapter_title=chapter_data["title"],
            chapter_outline=chapter_prompt,
            world_theme=world_theme,
            relevant_characters=characters,  # You might want to filter for relevant characters only
            scene_details="",  # This would be filled if scenes were generated first
            action_beats=action_beats,
            previous_context=previous_context,
            point_of_view=point_of_view,
            tense=tense,
        ),
    )

    def generate():
        # Send a heartbeat to establish the connection
        yield 'data: {"content": ""}\n\n'

        # Collect all chunks to save the complete response
        collected_content = []

        # Iterate through the stream to get each chunk
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                collected_content.append(content)
                # Send each token as it arrives
                yield f"data: {json.dumps({'content': content})}\n\n"

        # Combine all chunks for the complete content
        complete_content = "".join(collected_content)

        # Save chapter content to file
        chapter_path = os.path.join(
            CHAPTERS_DIR, f"chapter_{chapter_number}{TEXT_EXTENSION}"
        )
        with open(chapter_path, "w", encoding="utf-8") as f:
            f.write(complete_content)

        # Send completion marker
        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/chapter_editor/<int:chapter_number>", methods=["GET"])
def chapter_editor(chapter_number):
    """Generate or display a specific chapter for editing"""
    chapters = get_chapters()

    # Check if chapter exists
    chapter_data = None
    for ch in chapters:
        if ch["chapter_number"] == chapter_number:
            chapter_data = ch
            break

    if not chapter_data:
        return render_template(
            "error.html", message=f"Chapter {chapter_number} not found"
        )

    settings = get_settings()

    # Get existing chapter content for editing
    chapter_file_path = os.path.join(
        CHAPTERS_DIR, f"chapter_{chapter_number}{TEXT_EXTENSION}"
    )
    original_chapter_content = ""
    if os.path.exists(chapter_file_path):
        with open(chapter_file_path, "r") as f:
            original_chapter_content = f.read()

    # Get editor review content if it exists
    editor_review_file_path = os.path.join(
        CHAPTERS_DIR, f"chapter_{chapter_number}_editor{TEXT_EXTENSION}"
    )
    chapter_content = ""
    has_review = False
    if os.path.exists(editor_review_file_path):
        with open(editor_review_file_path, "r") as f:
            chapter_content = f.read()
        has_review = True

    # Get previous chapters context
    previous_context = ""
    if chapter_number > 1:
        prev_chapter_path = os.path.join(
            CHAPTERS_DIR, f"chapter_{chapter_number - 1}{TEXT_EXTENSION}"
        )
        if os.path.exists(prev_chapter_path):
            with open(prev_chapter_path, "r") as f:
                prev_content = f.read()
                # Take the last N characters of the previous chapter
                previous_context = prev_content[-PREVIOUS_CHAPTER_CONTEXT_LENGTH:]

    master_prompt = get_master_prompt()
    action_beats_content = get_action_beats(chapter_number)

    # Get point of view and tense from settings
    chapter_settings = settings.get("chapters", {}).get(str(chapter_number), {})
    point_of_view = chapter_settings.get("point_of_view", "Third-person limited")
    tense = chapter_settings.get("tense", "Past tense")

    return render_template(
        "chapter_editor.html",
        chapter=chapter_data,
        chapters=chapters,
        original_chapter_content=original_chapter_content,
        chapter_content=chapter_content,
        has_review=has_review,
        previous_context=previous_context,
        master_prompt=master_prompt,
        point_of_view=point_of_view,
        tense=tense,
        action_beats_content=action_beats_content,
    )


@app.route("/chapter_editor_stream/<int:chapter_number>", methods=["POST"])
def chapter_editor_stream(chapter_number):
    """Generate or display a specific chapter"""
    chapters = get_chapters()

    # Check if chapter exists
    chapter_data = None
    for ch in chapters:
        if ch["chapter_number"] == chapter_number:
            chapter_data = ch
            break

    if not chapter_data:
        return Response(
            json.dumps({"error": f"Chapter {chapter_number} not found"}),
            status=404,
            mimetype="application/json",
        )

    data = request.json
    # Get any additional context from the chat interface
    additional_context = data.get("additional_context", "")
    master_prompt = data.get("master_prompt", "")
    point_of_view = data.get("point_of_view", "Third-person limited")
    tense = data.get("tense", "Past tense")
    action_beats = data.get("action_beats_content", "")
    chapter_content = data.get("chapter_content", "")

    # Generate chapter content
    world_theme = get_world_theme()
    characters = get_characters()

    # Get previous chapters context
    previous_context = ""
    if chapter_number > 1:
        prev_chapter_path = os.path.join(
            CHAPTERS_DIR, f"chapter_{chapter_number - 1}{TEXT_EXTENSION}"
        )
        if os.path.exists(prev_chapter_path):
            with open(prev_chapter_path, "r") as f:
                # Get a summary or the last few paragraphs
                content = f.read()
                previous_context = content[-PREVIOUS_CHAPTER_CONTEXT_LENGTH:]

    # Initialize agents for chapter generation
    book_agents = BookAgents(agent_config, chapters)
    book_agents.create_agents(world_theme, len(chapters))

    # Add the additional context from chat to the chapter prompt
    chapter_prompt = (
        f"{chapter_data['prompt']}\n\n{additional_context}"
        if additional_context
        else chapter_data["prompt"]
    )

    # Generate the chapter
    stream = book_agents.generate_content_stream(
        "editor",
        prompts.CHAPTER_EDITING_PROMPT.format(
            master_prompt=master_prompt,
            chapter_number=chapter_number,
            chapter_title=chapter_data["title"],
            chapter_outline=chapter_prompt,
            world_theme=world_theme,
            relevant_characters=characters,  # You might want to filter for relevant characters only
            scene_details="",  # This would be filled if scenes were generated first
            action_beats=action_beats,
            previous_context=previous_context,
            point_of_view=point_of_view,
            tense=tense,
            chapter_content=chapter_content,
        ),
    )

    def generate():
        # Send a heartbeat to establish the connection
        yield 'data: {"content": ""}\n\n'

        # Iterate through the stream to get each chunk
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                # Send each token as it arrives
                yield f"data: {json.dumps({'content': content})}\n\n"

        # Send completion marker
        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/save_chapter/<int:chapter_number>", methods=["POST"])
def save_chapter(chapter_number):
    """Save edited chapter content"""
    chapter_content = request.form.get("chapter_content")

    # Strip extra newlines at the beginning and normalize newlines
    chapter_content = chapter_content.strip()

    chapter_path = os.path.join(
        CHAPTERS_DIR, f"chapter_{chapter_number}{TEXT_EXTENSION}"
    )
    with open(chapter_path, "w") as f:
        f.write(chapter_content)

    return jsonify({"success": True})


@app.route("/save_chapter_editor/<int:chapter_number>", methods=["POST"])
def save_chapter_editor(chapter_number):
    """Save edited chapter content (editor version)"""
    chapter_content = request.form.get("chapter_content")

    # Strip extra newlines at the beginning and normalize newlines
    chapter_content = chapter_content.strip()

    chapter_path = os.path.join(
        CHAPTERS_DIR, f"chapter_{chapter_number}_editor{TEXT_EXTENSION}"
    )
    with open(chapter_path, "w") as f:
        f.write(chapter_content)

    return jsonify({"success": True})


@app.route("/save_master_prompt", methods=["POST"])
def save_master_prompt():
    """Save the master prompt to a file."""
    master_prompt = request.form.get("master_prompt", "")
    with open(MASTER_PROMPT_FILE, "w") as f:
        f.write(master_prompt)
    return jsonify({"success": True})


@app.route("/save_setting", methods=["POST"])
def save_setting():
    """Save a specific setting value."""
    data = request.json
    key = data.get("key")
    value = data.get("value")

    if not key or value is None:
        return jsonify({"error": "Key or value missing"}), 400

    settings = get_settings()
    settings[key] = value
    save_settings(settings)

    return jsonify({"success": True})


@app.route("/scene/<int:chapter_number>", methods=["GET", "POST"])
def scene(chapter_number):
    """Generate a scene for a specific chapter"""
    # Load chapters data - similar logic to the chapter route
    chapters = get_chapters()

    # Print diagnostic info
    print(f"Number of chapters loaded: {len(chapters)}")
    print(f"Looking for chapter: {chapter_number}")
    if chapters:
        print(
            f"Available chapter numbers: {[ch.get('chapter_number') for ch in chapters]}"
        )

    # Find chapter data
    chapter_data = None
    for ch in chapters:
        if ch.get("chapter_number") == chapter_number:
            chapter_data = ch
            break

    if not chapter_data:
        print(f"Chapter {chapter_number} not found in loaded data")
        # Try alternate approaches to find the chapter

        # Approach 1: Direct file check
        chapter_path = os.path.join(
            CHAPTERS_DIR, f"chapter_{chapter_number}{TEXT_EXTENSION}"
        )
        if os.path.exists(chapter_path):
            # Chapter exists but data isn't in memory
            chapter_data = {
                "chapter_number": chapter_number,
                "title": f"Chapter {chapter_number}",
                "prompt": "Chapter content from file",
            }
            print("Found chapter file, creating basic chapter data")
        else:
            # Approach 2: Create stub data if no chapters exist yet
            chapter_data = {
                "chapter_number": chapter_number,
                "title": f"Chapter {chapter_number}",
                "prompt": "No chapter outline available",
            }
            print("Creating stub chapter data")

    if request.method == "POST":
        # scene description is not used in this context, but can be added if needed
        # scene_description = request.form.get("scene_description", "")

        # Generate the scene
        world_theme = get_world_theme()
        characters = get_characters()

        # Get previous context
        previous_context = ""
        if chapter_number > 1:
            prev_chapter_path = os.path.join(
                CHAPTERS_DIR, f"chapter_{chapter_number - 1}{TEXT_EXTENSION}"
            )
            if os.path.exists(prev_chapter_path):
                with open(prev_chapter_path, "r") as f:
                    content = f.read()
                    previous_context = content[-PREVIOUS_CHAPTER_CONTEXT_LENGTH:]

        # Initialize agents
        book_agents = BookAgents(agent_config, chapters)
        book_agents.create_agents(world_theme, len(chapters) if chapters else 1)

        # Generate the scene
        scene_content = book_agents.generate_content(
            "writer",
            prompts.SCENE_GENERATION_PROMPT.format(
                chapter_number=chapter_number,
                chapter_title=chapter_data.get("title", f"Chapter {chapter_number}"),
                chapter_outline=chapter_data.get("prompt", ""),
                world_theme=world_theme,
                relevant_characters=characters,
                previous_context=previous_context,
            ),
        )

        # Save scene to a file
        scene_dir = os.path.join(CHAPTERS_DIR, f"chapter_{chapter_number}_scenes")
        os.makedirs(scene_dir, exist_ok=True)

        # Count existing scenes and create a new one
        scene_count = len(
            [f for f in os.listdir(scene_dir) if f.endswith(TEXT_EXTENSION)]
        )
        scene_path = os.path.join(scene_dir, f"scene_{scene_count + 1}{TEXT_EXTENSION}")

        with open(scene_path, "w") as f:
            f.write(scene_content)

        return jsonify({"scene_content": scene_content})

    # GET request - load existing scenes for this chapter
    scenes = []
    scene_dir = os.path.join(CHAPTERS_DIR, f"chapter_{chapter_number}_scenes")

    if os.path.exists(scene_dir):
        scene_files = [f for f in os.listdir(scene_dir) if f.endswith(TEXT_EXTENSION)]
        scene_files.sort(
            key=lambda f: int(f.split("_")[1].split(".")[0])
        )  # Sort by scene number

        for scene_file in scene_files:
            scene_path = os.path.join(scene_dir, scene_file)
            scene_number = int(scene_file.split("_")[1].split(".")[0])

            with open(scene_path, "r") as f:
                content = f.read()

                # Extract a title from the first line or first few words
                lines = content.split("\n")
                if lines:
                    title = lines[0][:30] + "..." if len(lines[0]) > 30 else lines[0]
                else:
                    title = f"Scene {scene_number}"

                scenes.append(
                    {"number": scene_number, "title": title, "content": content}
                )

    # Return the template with loaded scenes
    return render_template("scene.html", chapter=chapter_data, scenes=scenes)


@app.route("/save_action_beats/<int:chapter_number>", methods=["POST"])
def save_action_beats(chapter_number):
    """Save edited action beats content"""
    action_beats_content = request.form.get("action_beats_content")

    # Strip extra newlines at the beginning and normalize newlines
    action_beats_content = action_beats_content.strip()

    action_beats_path = os.path.join(
        CHAPTERS_DIR, f"chapter_{chapter_number}_action_beats{TEXT_EXTENSION}"
    )
    with open(action_beats_path, "w") as f:
        f.write(action_beats_content)

    return jsonify({"success": True})


@app.route("/action_beats_chat/<int:chapter_number>", methods=["GET"])
def action_beats_chat(chapter_number):
    """Display action beats chat interface"""
    chapters = get_chapters()
    chapter_data = next(
        (ch for ch in chapters if ch["chapter_number"] == chapter_number), None
    )

    if not chapter_data:
        return render_template(
            "error.html", message=f"Chapter {chapter_number} not found"
        )

    action_beats_content = get_action_beats(chapter_number)
    return render_template(
        "action_beats_chat.html",
        chapter=chapter_data,
        action_beats_content=action_beats_content,
        chapters=chapters,  # Pass the chapters list
    )


@app.route("/action_beats_chat_stream/<int:chapter_number>", methods=["POST"])
def action_beats_chat_stream(chapter_number):
    """Handle ongoing chat for action beats creation with streaming response"""
    chapters = get_chapters()
    chapter_data = next(
        (ch for ch in chapters if ch["chapter_number"] == chapter_number), None
    )

    if not chapter_data:
        return jsonify({"error": f"Chapter {chapter_number} not found"}), 404

    data = request.json
    user_message = data.get("message", "")
    chat_history = data.get("chat_history", [])

    world_theme = get_world_theme()
    characters = get_characters()

    book_agents = BookAgents(agent_config, chapters)
    book_agents.create_agents(world_theme, len(chapters) if chapters else 1)

    stream = book_agents.generate_chat_response_action_beats_stream(
        chat_history,
        chapter_data.get("prompt", ""),
        world_theme,
        characters,
        user_message,
    )

    def generate():
        yield 'data: {"content": ""}\n\n'
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                yield f"data: {json.dumps({'content': content})}\n\n"
        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/finalize_action_beats_stream/<int:chapter_number>", methods=["POST"])
def finalize_action_beats_stream(chapter_number):
    """Finalize the action beats based on chat history with streaming response"""
    chapters = get_chapters()
    chapter_data = next(
        (ch for ch in chapters if ch["chapter_number"] == chapter_number), None
    )

    if not chapter_data:
        return jsonify({"error": f"Chapter {chapter_number} not found"}), 404

    data = request.json
    chat_history = data.get("chat_history", [])
    num_beats = data.get("num_beats", 12)

    world_theme = get_world_theme()
    characters = get_characters()

    book_agents = BookAgents(agent_config, chapters)
    book_agents.create_agents(world_theme, len(chapters) if chapters else 1)

    stream = book_agents.generate_final_action_beats_stream(
        chat_history,
        chapter_data.get("prompt", ""),
        world_theme,
        characters,
        num_beats,
    )

    def generate():
        yield 'data: {"content": ""}\n\n'
        collected_content = []
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                collected_content.append(content)
                yield f"data: {json.dumps({'content': content})}\n\n"

        complete_content = "".join(collected_content)
        action_beats_path = os.path.join(
            CHAPTERS_DIR, f"chapter_{chapter_number}_action_beats{TEXT_EXTENSION}"
        )
        with open(action_beats_path, "w") as f:
            f.write(complete_content)

        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/characters_chat", methods=["POST"])
def characters_chat():
    """Handle ongoing chat for character creation"""
    data = request.json
    user_message = data.get("message", "")
    chat_history = data.get("chat_history", [])
    world_theme = get_world_theme()

    # Ensure we have a world theme
    if not world_theme:
        return jsonify(
            {"error": "World theme not found. Please complete world building first."}
        )

    # Initialize agents for character creation
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(world_theme, 0)

    # Generate response using the direct chat method
    ai_response = book_agents.generate_chat_response_characters(
        chat_history, world_theme, user_message
    )

    # Clean the response
    ai_response = ai_response.strip()

    return jsonify({"message": ai_response})


@app.route("/characters_chat_stream", methods=["POST"])
def characters_chat_stream():
    """Handle ongoing chat for character creation with streaming response"""
    data = request.json
    user_message = data.get("message", "")
    chat_history = data.get("chat_history", [])
    world_theme = get_world_theme()

    # Ensure we have a world theme
    if not world_theme:
        return jsonify(
            {"error": "World theme not found. Please complete world building first."}
        )

    # Initialize agents for character creation
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(world_theme, 0)

    # Generate streaming response
    stream = book_agents.generate_chat_response_characters_stream(
        chat_history, world_theme, user_message
    )

    def generate():
        # Send a heartbeat to establish the connection
        yield 'data: {"content": ""}\n\n'

        # Iterate through the stream to get each chunk
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                # Send each token as it arrives
                yield f"data: {json.dumps({'content': content})}\n\n"

        # Send completion marker
        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/finalize_characters_stream", methods=["POST"])
def finalize_characters_stream():
    """Finalize the characters based on chat history with streaming response"""
    data = request.json
    chat_history = data.get("chat_history", [])
    num_characters = data.get("num_characters", 3)
    world_theme = get_world_theme()

    # Ensure we have a world theme
    if not world_theme:
        return jsonify(
            {"error": "World theme not found. Please complete world building first."}
        )

    # Initialize agents for character creation
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(world_theme, 0)

    # Generate the final characters using streaming
    stream = book_agents.generate_final_characters_stream(
        chat_history, world_theme, num_characters
    )

    def generate():
        # Send a heartbeat to establish the connection
        yield 'data: {"content": ""}\n\n'

        # Collect all chunks to save the complete response
        collected_content = []

        # Iterate through the stream to get each chunk
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                collected_content.append(content)
                # Send each token as it arrives
                yield f"data: {json.dumps({'content': content})}\n\n"

        # Combine all chunks for the complete content
        complete_content = "".join(collected_content)

        # Clean and save characters to file once streaming is complete
        characters_content = complete_content.strip()

        with open(CHARACTERS_FILE, "w") as f:
            f.write(characters_content)

        # Send completion marker
        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/outline_chat", methods=["POST"])
def outline_chat():
    """Handle ongoing chat for outline creation"""
    data = request.json
    user_message = data.get("message", "")
    chat_history = data.get("chat_history", [])
    num_chapters = data.get("num_chapters", 10)

    # Get world_theme and characters for context
    world_theme = get_world_theme()
    characters = get_characters()

    # Ensure we have world and characters
    if not world_theme or not characters:
        return jsonify(
            {
                "error": "World theme or characters not found. Please complete previous steps first."
            }
        )

    # Initialize agents for outline creation
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(world_theme, num_chapters)

    # Generate response using the direct chat method
    ai_response = book_agents.generate_chat_response_outline(
        chat_history, world_theme, characters, user_message
    )

    # Clean the response
    ai_response = ai_response.strip()

    return jsonify({"message": ai_response})


@app.route("/outline_chat_stream", methods=["POST"])
def outline_chat_stream():
    """Handle ongoing chat for outline creation with streaming response"""
    data = request.json
    user_message = data.get("message", "")
    chat_history = data.get("chat_history", [])
    num_chapters = data.get("num_chapters", 10)

    # Get world_theme and characters for context
    world_theme = get_world_theme()
    characters = get_characters()

    # Ensure we have world and characters
    if not world_theme or not characters:
        return jsonify(
            {
                "error": "World theme or characters not found. Please complete previous steps first."
            }
        )

    # Initialize agents for outline creation
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(world_theme, num_chapters)

    # Generate streaming response
    stream = book_agents.generate_chat_response_outline_stream(
        chat_history, world_theme, characters, user_message
    )

    def generate():
        # Send a heartbeat to establish the connection
        yield 'data: {"content": ""}\n\n'

        # Iterate through the stream to get each chunk
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                # Send each token as it arrives
                yield f"data: {json.dumps({'content': content})}\n\n"

        # Send completion marker
        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/finalize_outline_stream", methods=["POST"])
def finalize_outline_stream():
    """Finalize the outline based on chat history with streaming response"""
    data = request.json
    chat_history = data.get("chat_history", [])
    num_chapters = data.get("num_chapters", 10)

    # Get world_theme and characters for context
    world_theme = get_world_theme()
    characters = get_characters()

    # Ensure we have world and characters
    if not world_theme or not characters:
        return jsonify(
            {
                "error": "World theme or characters not found. Please complete previous steps first."
            }
        )

    # Initialize agents for outline creation
    book_agents = BookAgents(agent_config)
    book_agents.create_agents(world_theme, num_chapters)

    # Generate the final outline using streaming
    stream = book_agents.generate_final_outline_stream(
        chat_history, world_theme, characters, num_chapters
    )

    def generate():
        # Send a heartbeat to establish the connection
        yield 'data: {"content": ""}\n\n'

        # Collect all chunks to save the complete response
        collected_content = []

        # Iterate through the stream to get each chunk
        for chunk in stream:
            if (
                chunk.choices
                and len(chunk.choices) > 0
                and chunk.choices[0].delta
                and chunk.choices[0].delta.content is not None
            ):
                content = chunk.choices[0].delta.content
                collected_content.append(content)
                # Send each token as it arrives
                yield f"data: {json.dumps({'content': content})}\n\n"

        # Combine all chunks for the complete content
        complete_content = "".join(collected_content)

        # Clean and save outline to file once streaming is complete
        outline_content = complete_content.strip()

        # Save to file
        with open(OUTLINE_FILE, "w") as f:
            f.write(outline_content)

        # Try to parse chapters
        chapters = parse_outline_to_chapters(outline_content, num_chapters)

        # Save structured outline for later use
        with open(OUTLINE_JSON_FILE, "w") as f:
            json.dump(chapters, f, indent=2)

        # Send completion marker
        yield f"data: {json.dumps({'content': '[DONE]'})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def parse_outline_to_chapters(outline_content, num_chapters):
    """Helper function to parse outline content into structured chapter format"""
    chapters = []
    try:
        # Extract just the outline content (between OUTLINE: and END OF OUTLINE)
        start_idx = outline_content.find("OUTLINE:")
        end_idx = outline_content.find("END OF OUTLINE")
        if start_idx != -1 and end_idx != -1:
            outline_text = outline_content[
                start_idx + len("OUTLINE:") : end_idx
            ].strip()
        else:
            outline_text = outline_content

        # Split by chapter using a more specific regex to avoid duplicate chapters
        chapter_matches = re.finditer(r"Chapter\s+(\d+):\s+([^\n]+)", outline_text)
        seen_chapters = set()

        for match in chapter_matches:
            chapter_num = int(match.group(1))
            chapter_title = match.group(2).strip()

            # Skip duplicate chapter numbers
            if chapter_num in seen_chapters:
                continue

            seen_chapters.add(chapter_num)

            # Find the end of this chapter's content (start of next chapter or end of text)
            start_pos = match.start()
            next_chapter_match = re.search(
                r"Chapter\s+(\d+):", outline_text[start_pos + 1 :]
            )

            if next_chapter_match:
                end_pos = start_pos + 1 + next_chapter_match.start()
                chapter_content = outline_text[start_pos:end_pos].strip()
            else:
                chapter_content = outline_text[start_pos:].strip()

            # Extract just the content part, not including the chapter title line
            content_lines = chapter_content.split("\n")
            chapter_description = (
                "\n".join(content_lines[1:]) if len(content_lines) > 1 else ""
            )

            chapters.append(
                {
                    "chapter_number": chapter_num,
                    "title": chapter_title,
                    "prompt": chapter_description,
                }
            )

        # Sort chapters by chapter number to ensure correct order
        chapters.sort(key=lambda x: x["chapter_number"])

        # Only use num_chapters as a fallback if no chapters are found
        if not chapters:
            print(
                f"No chapters found in outline, creating {num_chapters} default chapters"
            )
            for i in range(1, num_chapters + 1):
                chapters.append(
                    {
                        "chapter_number": i,
                        "title": f"Chapter {i}",
                        "prompt": f"Content for chapter {i}",
                    }
                )

    except Exception as e:
        # Fallback if parsing fails
        print(f"Error parsing outline: {e}")
        for i in range(1, num_chapters + 1):
            chapters.append(
                {
                    "chapter_number": i,
                    "title": f"Chapter {i}",
                    "prompt": f"Content for chapter {i}",
                }
            )

    # Print diagnostic info
    print(f"Found {len(chapters)} chapters in the outline")

    # Save to the correct filename
    with open(CHAPTERS_JSON_FILE, "w") as f:
        json.dump(chapters, f, indent=2)

    return chapters


if __name__ == "__main__":
    # Check OpenAI connection on startup
    check_openai_connection(agent_config)

    # Notify if in debug mode
    if os.getenv("DEBUG", "False").lower() in ("true", "1", "t"):
        print("=" * 50)
        print("🚀 CAUTION: DEBUG mode is enabled.")
        print(
            f"📝 Prompts, requests, and responses will be saved to the '{PROMPT_DEBUGGING_DIR}' directory."
        )
        print("=" * 50)

    app.run(debug=True)
